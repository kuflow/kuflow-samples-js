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

import { catchAllErrors } from '@kuflow/kuflow-temporal-activity-kuflow'
import { ApplicationFailure } from '@temporalio/activity'
import axios from 'axios'

export const Activities = {
  Currency_convert: catchAllErrors(currencyConvert),
}

async function currencyConvert(amount: string, from: string, to: string): Promise<string> {
  const amountNumber = parseFloat(amount)

  const fromTransformed = transformCurrencyCode(from)
  const toTransformed = transformCurrencyCode(to)
  const endpoint = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${fromTransformed}.json`
  const response = await axios.get(endpoint)

  const conversionTable = response.data[fromTransformed]
  const conversion = conversionTable[toTransformed]

  return (amountNumber * conversion).toString()
}

function transformCurrencyCode(currency: string): string {
  switch (currency) {
    case 'EUR':
      return 'eur'
    case 'USD':
      return 'usd'
    case 'GBP':
      return 'gbp'
    default:
      throw ApplicationFailure.nonRetryable('Unsupported currency ' + currency, 'CurrencyConversion')
  }
}
