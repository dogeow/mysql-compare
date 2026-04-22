// 表结构视图：字段、索引、CREATE TABLE，并支持列/索引结构修改。
import { useEffect, useMemo, useState } from 'react'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Table, TBody, THead, Th, Tr, Td } from '@renderer/components/ui/table'
import { Badge } from '@renderer/components/ui/badge'
import { useUIStore } from '@renderer/store/ui-store'
import type { ColumnInfo, IndexInfo, TableSchema } from '../../../shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
}

interface PendingAction {
  title: string
  description: string
  sql: string
  successMessage: string
}

interface ColumnDraft {
  originalName: string
  name: string
  type: string
  nullable: boolean
  defaultValue: string
  useDefault: boolean
  comment: string
  isAutoIncrement: boolean
}

interface IndexDraft {
  mode: 'add' | 'edit'
  originalName?: string
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
  type: string
}

export function TableStructureView({ connectionId, database, table }: Props) {
  const { showToast } = useUIStore()
  const [schema, setSchema] = useState<TableSchema | null>(null)
  const [editingColumn, setEditingColumn] = useState<ColumnDraft | null>(null)
  const [editingIndex, setEditingIndex] = useState<IndexDraft | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)

  const loadSchema = async () => {
    const next = await unwrap<TableSchema>(api.schema.getTable(connectionId, database, table))
    setSchema(next)
  }

  useEffect(() => {
    loadSchema().catch((e) => showToast((e as Error).message, 'error'))
  }, [connectionId, database, table, showToast])

  const pendingColumnSQL = useMemo(() => {
    if (!editingColumn) return ''
    return buildAlterColumnSQL(database, table, editingColumn)
  }, [database, editingColumn, table])

  const pendingIndexSQL = useMemo(() => {
    if (!editingIndex) return ''
    return buildIndexSQL(database, table, editingIndex)
  }, [database, editingIndex, table])

  const startEditColumn = (column: ColumnInfo) => {
    setEditingColumn({
      originalName: column.name,
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      defaultValue: column.defaultValue ?? '',
      useDefault: column.defaultValue !== null,
      comment: column.comment,
      isAutoIncrement: column.isAutoIncrement
    })
  }

  const reviewColumnSQL = () => {
    if (!editingColumn) return
    if (!editingColumn.name.trim() || !editingColumn.type.trim()) {
      showToast('Column name and type are required', 'error')
      return
    }
    setPendingAction({
      title: 'Confirm Column Change',
      description: `Review SQL for ${database}.${table}.${editingColumn.originalName}`,
      sql: pendingColumnSQL,
      successMessage: 'Column structure updated'
    })
  }

  const startAddIndex = () => {
    setEditingIndex({
      mode: 'add',
      name: '',
      columns: [],
      unique: false,
      primary: false,
      type: 'BTREE'
    })
  }

  const startEditIndex = (index: IndexInfo) => {
    setEditingIndex({
      mode: 'edit',
      originalName: index.name,
      name: index.name === 'PRIMARY' ? 'PRIMARY' : index.name,
      columns: [...index.columns],
      unique: index.unique,
      primary: index.name === 'PRIMARY',
      type: index.type || 'BTREE'
    })
  }

  const reviewIndexSQL = () => {
    if (!editingIndex) return
    if (!editingIndex.primary && !editingIndex.name.trim()) {
      showToast('Index name is required', 'error')
      return
    }
    if (editingIndex.columns.length === 0) {
      showToast('Select at least one column', 'error')
      return
    }
    setPendingAction({
      title: editingIndex.mode === 'add' ? 'Confirm Add Index' : 'Confirm Index Change',
      description: `${database}.${table}`,
      sql: pendingIndexSQL,
      successMessage: editingIndex.mode === 'add' ? 'Index added' : 'Index updated'
    })
  }

  const reviewDeleteIndex = (index: IndexInfo) => {
    setPendingAction({
      title: 'Confirm Delete Index',
      description: `${database}.${table}.${index.name}`,
      sql: buildDropIndexSQL(database, table, index.name),
      successMessage: `Index ${index.name} deleted`
    })
  }

  const executePendingAction = async () => {
    if (!pendingAction) return
    setBusy(true)
    try {
      await unwrap(api.db.executeSQL(connectionId, pendingAction.sql, database))
      showToast(pendingAction.successMessage, 'success')
      setPendingAction(null)
      setEditingColumn(null)
      setEditingIndex(null)
      await loadSchema()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!schema) return <div className="p-3 text-xs text-muted-foreground">Loading...</div>

  return (
    <div className="h-full min-h-0 overflow-auto p-3 pb-8 space-y-4">
      <section>
        <h3 className="mb-2 text-sm font-medium">Columns</h3>
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Null</Th>
              <Th>Default</Th>
              <Th>Key</Th>
              <Th>Extra</Th>
              <Th>Comment</Th>
              <Th className="w-20">Action</Th>
            </Tr>
          </THead>
          <TBody>
            {schema.columns.map((column) => (
              <Tr key={column.name}>
                <Td>{column.name}</Td>
                <Td className="text-muted-foreground">{column.type}</Td>
                <Td>{column.nullable ? 'YES' : 'NO'}</Td>
                <Td>{column.defaultValue ?? <span className="opacity-50">NULL</span>}</Td>
                <Td>
                  {column.isPrimaryKey && <Badge variant="warning">PRI</Badge>}
                  {!column.isPrimaryKey && column.columnKey && <Badge>{column.columnKey}</Badge>}
                </Td>
                <Td>{column.isAutoIncrement && <Badge variant="info">AUTO_INC</Badge>}</Td>
                <Td className="text-muted-foreground">{column.comment}</Td>
                <Td>
                  <Button size="sm" variant="outline" onClick={() => startEditColumn(column)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Indexes</h3>
          <Button size="sm" variant="outline" onClick={startAddIndex}>
            <Plus className="h-3.5 w-3.5" /> Add Index
          </Button>
        </div>
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Columns</Th>
              <Th>Unique</Th>
              <Th>Type</Th>
              <Th className="w-36">Action</Th>
            </Tr>
          </THead>
          <TBody>
            {schema.indexes.map((index) => (
              <Tr key={index.name}>
                <Td>{index.name}</Td>
                <Td>{index.columns.join(', ')}</Td>
                <Td>{index.unique ? 'YES' : 'NO'}</Td>
                <Td>{index.type}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEditIndex(index)}>
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reviewDeleteIndex(index)}>
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">CREATE TABLE</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(schema.createSQL)
              showToast('SQL copied', 'success')
            }}
          >
            <Copy className="w-3 h-3" /> Copy
          </Button>
        </div>
        <pre className="overflow-auto whitespace-pre rounded border border-border bg-card p-3 text-xs">
{schema.createSQL}
        </pre>
      </section>

      {editingColumn && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) {
              setEditingColumn(null)
            }
          }}
          title="Edit Column"
          description={`${database}.${table}.${editingColumn.originalName}`}
          className="max-w-2xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditingColumn(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={reviewColumnSQL} disabled={busy}>
                Review SQL
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block">Column Name</Label>
              <Input
                value={editingColumn.name}
                onChange={(event) =>
                  setEditingColumn((current) =>
                    current ? { ...current, name: event.target.value } : current
                  )
                }
              />
            </div>
            <div>
              <Label className="mb-1 block">Type</Label>
              <Input
                value={editingColumn.type}
                onChange={(event) =>
                  setEditingColumn((current) =>
                    current ? { ...current, type: event.target.value } : current
                  )
                }
              />
            </div>
            <div className="col-span-2 flex items-center gap-4 pt-1 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={editingColumn.nullable}
                  onChange={(event) =>
                    setEditingColumn((current) =>
                      current ? { ...current, nullable: event.target.checked } : current
                    )
                  }
                />
                Nullable
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={editingColumn.useDefault}
                  onChange={(event) =>
                    setEditingColumn((current) =>
                      current ? { ...current, useDefault: event.target.checked } : current
                    )
                  }
                />
                Set Default
              </label>
              {editingColumn.isAutoIncrement && <Badge variant="info">AUTO_INCREMENT preserved</Badge>}
            </div>
            <div className="col-span-2">
              <Label className="mb-1 block">Default Value</Label>
              <Input
                value={editingColumn.defaultValue}
                onChange={(event) =>
                  setEditingColumn((current) =>
                    current ? { ...current, defaultValue: event.target.value } : current
                  )
                }
                disabled={!editingColumn.useDefault}
                placeholder="Leave empty with Set Default on to write DEFAULT NULL"
              />
            </div>
            <div className="col-span-2">
              <Label className="mb-1 block">Comment</Label>
              <Input
                value={editingColumn.comment}
                onChange={(event) =>
                  setEditingColumn((current) =>
                    current ? { ...current, comment: event.target.value } : current
                  )
                }
              />
            </div>
          </div>
        </Dialog>
      )}

      {editingIndex && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) {
              setEditingIndex(null)
            }
          }}
          title={editingIndex.mode === 'add' ? 'Add Index' : 'Edit Index'}
          description={`${database}.${table}`}
          className="max-w-2xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditingIndex(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={reviewIndexSQL} disabled={busy}>
                Review SQL
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block">Index Name</Label>
              <Input
                value={editingIndex.name}
                onChange={(event) =>
                  setEditingIndex((current) =>
                    current ? { ...current, name: event.target.value } : current
                  )
                }
                disabled={editingIndex.primary}
                placeholder={editingIndex.primary ? 'PRIMARY' : 'idx_example'}
              />
            </div>
            <div>
              <Label className="mb-1 block">Index Type</Label>
              <Input
                value={editingIndex.type}
                onChange={(event) =>
                  setEditingIndex((current) =>
                    current ? { ...current, type: event.target.value.toUpperCase() } : current
                  )
                }
                disabled={editingIndex.primary}
                placeholder="BTREE"
              />
            </div>
            <div className="col-span-2 flex items-center gap-4 pt-1 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={editingIndex.primary}
                  onChange={(event) =>
                    setEditingIndex((current) => {
                      if (!current) return current
                      const primary = event.target.checked
                      return {
                        ...current,
                        primary,
                        unique: primary ? true : current.unique,
                        name: primary ? 'PRIMARY' : current.originalName === 'PRIMARY' ? '' : current.name
                      }
                    })
                  }
                />
                Primary key
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={editingIndex.unique || editingIndex.primary}
                  onChange={(event) =>
                    setEditingIndex((current) =>
                      current && !current.primary
                        ? { ...current, unique: event.target.checked }
                        : current
                    )
                  }
                  disabled={editingIndex.primary}
                />
                Unique
              </label>
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="block">Columns</Label>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto rounded border border-border p-3 text-sm">
                {schema.columns.map((column) => (
                  <label key={column.name} className="flex items-center gap-2">
                    <Checkbox
                      checked={editingIndex.columns.includes(column.name)}
                      onChange={(event) =>
                        setEditingIndex((current) => {
                          if (!current) return current
                          const nextColumns = event.target.checked
                            ? [...current.columns, column.name]
                            : current.columns.filter((name) => name !== column.name)
                          return { ...current, columns: nextColumns }
                        })
                      }
                    />
                    {column.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {pendingAction && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setPendingAction(null)
          }}
          title={pendingAction.title}
          description={pendingAction.description}
          className="max-w-3xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setPendingAction(null)} disabled={busy}>
                Back
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(pendingAction.sql)
                  showToast('SQL copied', 'success')
                }}
                disabled={busy}
              >
                <Copy className="w-3 h-3" /> Copy SQL
              </Button>
              <Button onClick={executePendingAction} disabled={busy}>
                {busy ? 'Executing...' : 'Confirm & Execute'}
              </Button>
            </>
          }
        >
          <pre className="max-h-[60vh] overflow-auto rounded border border-border bg-card p-3 text-xs whitespace-pre-wrap break-all">
            {pendingAction.sql}
          </pre>
        </Dialog>
      )}
    </div>
  )
}

function buildAlterColumnSQL(database: string, table: string, draft: ColumnDraft): string {
  const definition = [
    quoteIdent(draft.name.trim()),
    draft.type.trim(),
    draft.nullable ? 'NULL' : 'NOT NULL',
    buildDefaultClause(draft),
    draft.isAutoIncrement ? 'AUTO_INCREMENT' : '',
    `COMMENT ${quoteString(draft.comment)}`
  ]
    .filter(Boolean)
    .join(' ')

  const action =
    draft.originalName === draft.name.trim()
      ? 'MODIFY COLUMN'
      : `CHANGE COLUMN ${quoteIdent(draft.originalName)}`
  return `ALTER TABLE ${quoteTable(database, table)} ${action} ${definition};`
}

function buildIndexSQL(database: string, table: string, draft: IndexDraft): string {
  const addClause = buildAddIndexClause(draft)
  if (draft.mode === 'add') {
    return `ALTER TABLE ${quoteTable(database, table)} ${addClause};`
  }
  return `ALTER TABLE ${quoteTable(database, table)} ${buildDropIndexClausePart(draft.originalName || draft.name)}, ${addClause};`
}

function buildDropIndexSQL(database: string, table: string, indexName: string): string {
  return `ALTER TABLE ${quoteTable(database, table)} ${buildDropIndexClausePart(indexName)};`
}

function buildAddIndexClause(draft: IndexDraft): string {
  const columns = draft.columns.map((column) => quoteIdent(column)).join(', ')
  const usingClause = !draft.primary && draft.type.trim() ? `USING ${draft.type.trim().toUpperCase()} ` : ''
  if (draft.primary) {
    return `ADD PRIMARY KEY (${columns})`
  }
  if (draft.unique) {
    return `ADD UNIQUE INDEX ${quoteIdent(draft.name.trim())} ${usingClause}(${columns})`
  }
  return `ADD INDEX ${quoteIdent(draft.name.trim())} ${usingClause}(${columns})`
}

function buildDropIndexClausePart(indexName: string): string {
  return indexName === 'PRIMARY' ? 'DROP PRIMARY KEY' : `DROP INDEX ${quoteIdent(indexName)}`
}

function buildDefaultClause(draft: ColumnDraft): string {
  if (!draft.useDefault) return ''
  const value = draft.defaultValue.trim()
  if (!value) return 'DEFAULT NULL'
  if (isSQLKeywordDefault(value)) return `DEFAULT ${value}`
  if (isNumericLike(draft.type, value)) return `DEFAULT ${value}`
  return `DEFAULT ${quoteString(value)}`
}

function isSQLKeywordDefault(value: string): boolean {
  return /^(null|current_timestamp(?:\(\))?|current_date(?:\(\))?|current_time(?:\(\))?)$/i.test(value)
}

function isNumericLike(type: string, value: string): boolean {
  return /^(tinyint|smallint|mediumint|int|bigint|decimal|numeric|float|double|real|bit)/i.test(type) && /^-?\d+(\.\d+)?$/.test(value)
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function quoteTable(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`
}

function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}
