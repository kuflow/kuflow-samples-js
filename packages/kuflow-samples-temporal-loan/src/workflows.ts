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
import { getElementValueAsString, Process, Task } from '@kuflow/kuflow-rest'
import type { createKuFlowAsyncActivities, createKuFlowSyncActivities } from '@kuflow/kuflow-temporal-activity-kuflow'
import { WorkflowRequest, WorkflowResponse } from '@kuflow/kuflow-temporal-activity-kuflow'
import { LoggerSinks, proxyActivities, proxySinks, uuid4 } from '@temporalio/workflow'

import type * as activities from './activities'

const kuFlowSyncActivities = proxyActivities<ReturnType<typeof createKuFlowSyncActivities>>({
  startToCloseTimeout: '10 minutes',
  scheduleToCloseTimeout: '356 days',
})

const kuFlowAsyncActivities = proxyActivities<ReturnType<typeof createKuFlowAsyncActivities>>({
  startToCloseTimeout: '1 day',
  scheduleToCloseTimeout: '356 days',
})

const { convert } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
})

const { defaultWorkerLogger: logger } = proxySinks<LoggerSinks>()

/** A workflow that simply calls an activity */
export async function SampleEngineWorkerLoanWorkflow(workflowRequest: WorkflowRequest): Promise<WorkflowResponse> {
  logger.info('Start', {})

  const taskLoanApplication = await createTaskLoanApplication(workflowRequest)

  const currency = getElementValueAsString(taskLoanApplication, 'CURRENCY')
  const amount = getElementValueAsString(taskLoanApplication, 'AMOUNT')

  const amountEUR = await convertToEuros(currency, amount)

  let loanAuthorized = true
  if (amountEUR > 5_000) {
    const taskApproveLoan = await createTaskApproveLoan(taskLoanApplication, amountEUR)
    const approval = getElementValueAsString(taskApproveLoan, 'APPROVAL')

    loanAuthorized = approval === 'YES'
  }

  const process = await retrieveProcess(workflowRequest)
  if (loanAuthorized) {
    await createTaskNotificationGranted(process)
  } else {
    await createTaskNotificationRejection(process)
  }

  await kuFlowSyncActivities.KuFlow_Engine_completeProcess({ processId: workflowRequest.processId })

  logger.info('End', {})

  return { message: 'OK' }
}

async function createTaskLoanApplication(workflowRequest: WorkflowRequest): Promise<Task> {
  const taskId = uuid4()

  await kuFlowAsyncActivities.KuFlow_Engine_createTaskAndWaitFinished({
    task: {
      objectType: 'TASK',
      id: taskId,
      processId: workflowRequest.processId,
      taskDefinition: {
        code: 'TASK_LOAN_APPLICATION',
      },
    },
  })

  const { task } = await kuFlowSyncActivities.KuFlow_Engine_retrieveTask({ taskId })

  return task
}

/**
 * Create a task in KuFlow to approve the loan due to doesn't meet the restrictions.
 *
 * @param taskLoanApplication task created to request a loan
 * @param amountEUR amount requested
 * @return task created
 */
async function createTaskApproveLoan(taskLoanApplication: Task, amountEUR: number): Promise<Task> {
  const taskId = uuid4()

  const firstName = getElementValueAsString(taskLoanApplication, 'FIRSTNAME')
  const lastName = getElementValueAsString(taskLoanApplication, 'LASTNAME')

  await kuFlowAsyncActivities.KuFlow_Engine_createTaskAndWaitFinished({
    task: {
      objectType: 'TASK',
      id: taskId,
      processId: taskLoanApplication.processId,
      taskDefinition: {
        code: 'TASK_APPROVE_LOAN',
      },
      elementValues: {
        "FIRSTNAME": [{ type: 'STRING', value: firstName }],
        "LASTNAME": [{ type: 'STRING', value: lastName }],
        "AMOUNT": [{ type: 'STRING', value: amountEUR.toString() }],
      },
    },
  })

  const { task } = await kuFlowSyncActivities.KuFlow_Engine_retrieveTask({ taskId })

  return task
}

/**
 * Create a notification task showing that the loan was granted.
 *
 * @param process Related process
 */
async function createTaskNotificationGranted(process: Process): Promise<void> {
  const taskId = uuid4()

  await kuFlowSyncActivities.KuFlow_Engine_createTask({
    task: {
      objectType: 'TASK',
      id: taskId,
      processId: process.id ?? '',
      taskDefinition: {
        code: 'NOTIFICATION_GRANTED',
      },
      owner: process.initiator,
    },
  })
}

/**
 * Create a notification task showing that the loan was granted.
 *
 * @param process Related process
 */
async function createTaskNotificationRejection(process: Process): Promise<void> {
  const taskId = uuid4()

  await kuFlowSyncActivities.KuFlow_Engine_createTask({
    task: {
      objectType: 'TASK',
      id: taskId,
      processId: process.id ?? '',
      taskDefinition: {
        code: 'NOTIFICATION_REJECTION',
      },
      owner: process.initiator,
    },
  })
}

async function convertToEuros(currency: string, amount: string): Promise<number> {
  if (currency === 'EUR') {
    return parseFloat(amount)
  }

  const amountConverted = await convert(amount, currency, 'EUR')

  return parseFloat(amountConverted)
}

async function retrieveProcess(workflowRequest: WorkflowRequest): Promise<Process> {
  const { process } = await kuFlowSyncActivities.KuFlow_Engine_retrieveProcess({ processId: workflowRequest.processId })

  return process
}
