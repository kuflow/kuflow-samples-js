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
import { KuFlowRestClient } from '@kuflow/kuflow-rest'
import { createKuFlowAsyncActivities, createKuFlowSyncActivities } from '@kuflow/kuflow-temporal-activity-kuflow'
import { KuflowTemporalConnection } from '@kuflow/kuflow-temporal-core'
import { Runtime } from '@temporalio/worker'
import fs from 'fs'
import YAML from 'yaml'

import { Activities } from './activities'

/**
 * Run a Worker with an mTLS connection, configuration is provided via environment variables.
 * Note that serverNameOverride and serverRootCACertificate are optional.
 */
async function main(): Promise<void> {
  const workerProperties = loadConfiguration()

  // Instantiate KuFlow rest client
  const kuFlowRestClient = new KuFlowRestClient(
    {
      clientId: workerProperties.kuflow.api.clientId,
      clientSecret: workerProperties.kuflow.api.clientSecret,
    },
    {
      endpoint: workerProperties.kuflow.api.endpoint,
    },
  )

  // Configure kuflow temporal connection
  const kuflowTemporalConnection = await KuflowTemporalConnection.instance({
    kuflow: {
      restClient: kuFlowRestClient,
    },
    temporalio: {
      connection: {
        address: workerProperties.temporal.target,
      },
      worker: {
        taskQueue: workerProperties.temporal.kuflowQueue,
        workflowsPath: require.resolve('./workflows'),
        activities: {
          ...createKuFlowSyncActivities(kuFlowRestClient),
          ...createKuFlowAsyncActivities(kuFlowRestClient),
          ...Activities,
        },
      },
    },
  })

  Runtime.instance().logger.info('Worker connection successfully established')

  await kuflowTemporalConnection.runWorker()

  await kuflowTemporalConnection.close()
}

main().catch(error => {
  Runtime.instance().logger.error('Sample failed', { error })
  process.exit(1)
})

// Helpers for configuring the mTLS client and worker samples

export interface WorkerProperties {
  kuflow: {
    api: {
      endpoint?: string
      clientId: string
      clientSecret: string
    }
  }
  temporal: {
    target?: string
    kuflowQueue: string
  }
}

export function loadConfiguration(): WorkerProperties {
  const applicationMainYaml = readYamlFile('./application.yaml')
  const applicationLocalYaml = readYamlFile('./application-local.yaml')

  const applicationYaml = deepMerge(applicationMainYaml, applicationLocalYaml)

  return {
    kuflow: {
      api: {
        endpoint: findProperty(applicationYaml, 'kuflow.api.endpoint'),
        clientId: retrieveProperty(applicationYaml, 'kuflow.api.client-id'),
        clientSecret: retrieveProperty(applicationYaml, 'kuflow.api.client-secret'),
      },
    },
    temporal: {
      target: findProperty(applicationYaml, 'temporal.target'),
      kuflowQueue: retrieveProperty(applicationYaml, 'temporal.kuflow-queue'),
    },
  }
}

function readYamlFile(path: string): any {
  if (!fs.existsSync(path)) {
    return {}
  }

  const yaml = fs.readFileSync(path, 'utf8')

  return YAML.parse(yaml)
}

function deepMerge(source1: any, source2: any): object {
  const result = { ...source1, ...source2 }
  for (const key of Object.keys(result)) {
    result[key] =
      typeof source1[key] === 'object' && typeof source2[key] === 'object'
        ? deepMerge(source1[key], source2[key])
        : structuredClone(result[key])
  }

  return result
}

function retrieveProperty(config: any, path: string): string {
  const value = findProperty(config, path)
  if (value == null) {
    throw new ReferenceError(`${path} variable is not defined`)
  }

  return value
}

function findProperty(currentConfig: any, currentPath: string): string | undefined {
  const [property, ...restPath] = currentPath.split('.')
  const value = currentConfig[property]
  if (value == null) {
    return undefined
  }
  if (typeof value === 'object') {
    return findProperty(value, restPath.join('.'))
  }

  return value?.toString()
}
