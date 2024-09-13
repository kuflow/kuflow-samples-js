/**
 * The MIT License
 * Copyright © 2021-present KuFlow S.L.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import type { Process, ProcessItem } from '@kuflow/kuflow-rest'
import type { createKuFlowActivities, ProcessItemCreateRequest } from '@kuflow/kuflow-temporal-activity-kuflow'
import type { ProcessMetadataPatchRequest } from '@kuflow/kuflow-temporal-activity-kuflow/src/models/process'
import {
  KUFLOW_ENGINE_SIGNAL_PROCESS_ITEM,
  type SignalProcessItem,
  SignalProcessItemType,
  uuid7,
  type WorkflowRequest,
  type WorkflowResponse,
} from '@kuflow/kuflow-temporal-workflow-kuflow'
import { condition, defineSignal, log, proxyActivities, setHandler } from '@temporalio/workflow'

import type { Activities } from './activities'

const kuFlowActivities = proxyActivities<ReturnType<typeof createKuFlowActivities>>({
  startToCloseTimeout: '10 minutes',
  scheduleToCloseTimeout: '356 days',
})

const activities = proxyActivities<typeof Activities>({
  startToCloseTimeout: '1 minute',
})

export const kuFlowEngineSignalProcessItem = defineSignal<[SignalProcessItem]>(KUFLOW_ENGINE_SIGNAL_PROCESS_ITEM)

/** A workflow that simply calls an activity */
export async function SampleEngineWorkerLoanWorkflow(workflowRequest: WorkflowRequest): Promise<WorkflowResponse> {
  const kuFlowCompletedTaskIds: string[] = []

  setHandler(kuFlowEngineSignalProcessItem, (signal: SignalProcessItem) => {
    if (signal.type === SignalProcessItemType.TASK) {
      kuFlowCompletedTaskIds.push(signal.id)
    }
  })

  log.info('Start', {})

  const processItemLoanApplication = await createProcessItemTaskLoanApplicationForm(workflowRequest)

  await updateProcessMetadata(processItemLoanApplication)

  const currency = `${processItemLoanApplication.task?.data?.value.CURRENCY}`
  const amount = `${processItemLoanApplication.task?.data?.value.AMOUNT}`

  const amountEUR = await convertToEuros(currency, amount)

  let loanAuthorized = true
  if (amountEUR > 5_000) {
    const processItemApproveLoan = await createProcessItemTaskApproveLoan(processItemLoanApplication, amountEUR)
    const approval = `${processItemApproveLoan.task?.data?.value.APPROVAL}`

    loanAuthorized = approval === 'YES'
  }

  const process = await retrieveProcess(workflowRequest)
  if (loanAuthorized) {
    await createTaskNotificationGranted(process)
  } else {
    await createTaskNotificationRejection(process)
  }

  log.info('End', {})

  return { message: 'OK' }

  async function createProcessItemTaskLoanApplicationForm(workflowRequest: WorkflowRequest): Promise<ProcessItem> {
    const processItemId = uuid7()

    const processItemRequest: ProcessItemCreateRequest = {
      id: processItemId,
      type: 'TASK',
      processId: workflowRequest.processId,
      task: {
        taskDefinitionCode: 'LOAN_APPLICATION',
      },
    }

    await createProcessItemAndWaitCompleted(processItemRequest)

    const { processItem } = await kuFlowActivities.KuFlow_Engine_retrieveProcessItem({ processItemId })

    return processItem
  }

  async function updateProcessMetadata(processItemLoanApplication: ProcessItem): Promise<void> {
    const firstName = `${processItemLoanApplication.task?.data?.value.FIRST_NAME}`
    const lastName = `${processItemLoanApplication.task?.data?.value.LAST_NAME}`

    const request: ProcessMetadataPatchRequest = {
      processId: processItemLoanApplication.processId,
      jsonPatch: [
        {
          op: 'add',
          path: '/FIRST_NAME',
          value: firstName,
        },
        {
          op: 'add',
          path: '/LAST_NAME',
          value: lastName,
        },
      ],
    }

    await kuFlowActivities.KuFlow_Engine_patchProcessMetadata(request)
  }

  /**
   * Create a process item in KuFlow to approve the loan due to doesn't meet the restrictions.
   *
   * @param processItemLoanApplication process item created to request a loan
   * @param amountEUR amount requested
   * @return task created
   */
  async function createProcessItemTaskApproveLoan(processItemLoanApplication: ProcessItem, amountEUR: number): Promise<ProcessItem> {
    const processItemId = uuid7()

    const firstName = `${processItemLoanApplication.task?.data?.value.FIRST_NAME}`
    const lastName = `${processItemLoanApplication.task?.data?.value.LAST_NAME}`

    const processItemCreate: ProcessItemCreateRequest = {
      id: processItemId,
      type: 'TASK',
      processId: processItemLoanApplication.processId,
      task: {
        taskDefinitionCode: 'APPROVE_LOAN',
        data: {
          value: {
            FIRST_NAME: firstName,
            LAST_NAME: lastName,
            AMOUNT: amountEUR.toString(),
          },
        },
      },
    }

    await createProcessItemAndWaitCompleted(processItemCreate)

    const { processItem } = await kuFlowActivities.KuFlow_Engine_retrieveProcessItem({ processItemId })

    return processItem
  }

  /**
   * Create a notification task showing that the loan was granted.
   *
   * @param process Related process
   */
  async function createTaskNotificationGranted(process: Process): Promise<void> {
    const processItemId = uuid7()

    await kuFlowActivities.KuFlow_Engine_createProcessItem({
      id: processItemId,
      type: 'TASK',
      processId: process.id,
      ownerId: process.initiatorId,
      task: {
        taskDefinitionCode: 'NOTIFICATION_GRANTED',
      },
    })
  }

  /**
   * Create a notification task showing that the loan was granted.
   *
   * @param process Related process
   */
  async function createTaskNotificationRejection(process: Process): Promise<void> {
    const processItemId = uuid7()

    await kuFlowActivities.KuFlow_Engine_createProcessItem({
      id: processItemId,
      type: 'TASK',
      processId: process.id,
      ownerId: process.initiatorId,
      task: {
        taskDefinitionCode: 'NOTIFICATION_REJECTION',
      },
    })
  }

  async function convertToEuros(currency: string, amount: string): Promise<number> {
    if (currency === 'EUR') {
      return parseFloat(amount)
    }

    const amountConverted = await activities.Currency_convert(amount, currency, 'EUR')

    return parseFloat(amountConverted)
  }

  async function retrieveProcess(workflowRequest: WorkflowRequest): Promise<Process> {
    const { process } = await kuFlowActivities.KuFlow_Engine_retrieveProcess({ processId: workflowRequest.processId })

    return process
  }

  async function createProcessItemAndWaitCompleted(processItemCreate: ProcessItemCreateRequest): Promise<void> {
    const processItemId = processItemCreate.id
    if (processItemId == null) {
      throw Error('processItem id is required')
    }

    await kuFlowActivities.KuFlow_Engine_createProcessItem(processItemCreate)
    await condition(() => kuFlowCompletedTaskIds.includes(processItemId))
  }
}
