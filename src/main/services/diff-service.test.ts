import { beforeEach, describe, vi } from 'vitest'
import { registerDiffServiceDataTests } from './diff-service.data-cases'
import { registerDiffServiceSchemaTests } from './diff-service.schema-cases'

const { getDriver } = vi.hoisted(() => ({
  getDriver: vi.fn()
}))

vi.mock('./db-service', () => ({
  dbService: {
    getDriver
  }
}))

describe('DiffService', () => {
  beforeEach(() => {
    getDriver.mockReset()
  })

  registerDiffServiceSchemaTests(getDriver)
  registerDiffServiceDataTests(getDriver)
})
