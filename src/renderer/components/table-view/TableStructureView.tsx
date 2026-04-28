// 表结构视图：字段、索引、CREATE TABLE，并支持列/索引结构修改。
import { useEffect, useMemo, useState } from 'react'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Table, TBody, THead, Th, Tr, Td } from '@renderer/components/ui/table'
import { Badge } from '@renderer/components/ui/badge'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo, IndexInfo, TableSchema } from '../../../shared/types'
import { TableStructureDialogs } from './TableStructureDialogs'
import type { ColumnDraft, IndexDraft, PendingAction } from './table-structure-types'

interface Props {
  connectionId: string
  database: string
  table: string
}

export function TableStructureView({ connectionId, database, table }: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
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
      showToast(t('tableStructure.columnRequired'), 'error')
      return
    }
    setPendingAction({
      title: t('tableStructure.confirmColumnChange'),
      description: t('tableStructure.reviewSqlForColumn', {
        db: database,
        table,
        column: editingColumn.originalName
      }),
      sql: pendingColumnSQL,
      successMessage: t('tableStructure.columnUpdated')
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
      showToast(t('tableStructure.indexNameRequired'), 'error')
      return
    }
    if (editingIndex.columns.length === 0) {
      showToast(t('tableStructure.selectAtLeastOneColumn'), 'error')
      return
    }
    setPendingAction({
      title: editingIndex.mode === 'add'
        ? t('tableStructure.confirmAddIndex')
        : t('tableStructure.confirmIndexChange'),
      description: `${database}.${table}`,
      sql: pendingIndexSQL,
      successMessage: editingIndex.mode === 'add'
        ? t('tableStructure.indexAdded')
        : t('tableStructure.indexUpdated')
    })
  }

  const reviewDeleteIndex = (index: IndexInfo) => {
    setPendingAction({
      title: t('tableStructure.confirmDeleteIndex'),
      description: `${database}.${table}.${index.name}`,
      sql: buildDropIndexSQL(database, table, index.name),
      successMessage: t('tableStructure.indexDeleted', { name: index.name })
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

  if (!schema) return <div className="p-3 text-xs text-muted-foreground">{t('common.loading')}</div>

  return (
    <div className="h-full min-h-0 overflow-auto p-3 pb-8 space-y-4">
      <section>
        <h3 className="mb-2 text-sm font-medium">{t('common.columns')}</h3>
        <Table>
          <THead>
            <Tr>
              <Th>{t('common.name')}</Th>
              <Th>{t('common.type')}</Th>
              <Th>{t('tableStructure.columnHeaders.null')}</Th>
              <Th>{t('tableStructure.columnHeaders.default')}</Th>
              <Th>{t('tableStructure.columnHeaders.key')}</Th>
              <Th>{t('tableStructure.columnHeaders.extra')}</Th>
              <Th>{t('common.comment')}</Th>
              <Th className="w-20">{t('common.action')}</Th>
            </Tr>
          </THead>
          <TBody>
            {schema.columns.map((column) => (
              <Tr key={column.name}>
                <Td>{column.name}</Td>
                <Td className="text-muted-foreground">{column.type}</Td>
                <Td>{column.nullable ? t('common.yes') : t('common.no')}</Td>
                <Td>{column.defaultValue ?? <span className="opacity-50">NULL</span>}</Td>
                <Td>
                  {column.isPrimaryKey && <Badge variant="warning">{t('tableStructure.pri')}</Badge>}
                  {!column.isPrimaryKey && column.columnKey && <Badge>{column.columnKey}</Badge>}
                </Td>
                <Td>{column.isAutoIncrement && <Badge variant="info">{t('tableStructure.autoInc')}</Badge>}</Td>
                <Td className="text-muted-foreground">{column.comment}</Td>
                <Td>
                  <Button size="sm" variant="outline" onClick={() => startEditColumn(column)}>
                    <Pencil className="h-3 w-3" /> {t('common.edit')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('tableStructure.indexes')}</h3>
          <Button size="sm" variant="outline" onClick={startAddIndex}>
            <Plus className="h-3.5 w-3.5" /> {t('tableStructure.addIndex')}
          </Button>
        </div>
        <Table>
          <THead>
            <Tr>
              <Th>{t('common.name')}</Th>
              <Th>{t('common.columns')}</Th>
              <Th>{t('tableStructure.indexHeaders.unique')}</Th>
              <Th>{t('common.type')}</Th>
              <Th className="w-36">{t('common.action')}</Th>
            </Tr>
          </THead>
          <TBody>
            {schema.indexes.map((index) => (
              <Tr key={index.name}>
                <Td>{index.name}</Td>
                <Td>{index.columns.join(', ')}</Td>
                <Td>{index.unique ? t('common.yes') : t('common.no')}</Td>
                <Td>{index.type}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEditIndex(index)}>
                      <Pencil className="h-3 w-3" /> {t('common.edit')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reviewDeleteIndex(index)}>
                      <Trash2 className="h-3 w-3" /> {t('common.delete')}
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
              showToast(t('common.sqlCopied'), 'success')
            }}
          >
            <Copy className="w-3 h-3" /> {t('common.copy')}
          </Button>
        </div>
        <pre className="overflow-auto whitespace-pre rounded border border-border bg-card p-3 text-xs">
{schema.createSQL}
        </pre>
      </section>

      <TableStructureDialogs
        database={database}
        table={table}
        busy={busy}
        columns={schema.columns}
        editingColumn={editingColumn}
        setEditingColumn={setEditingColumn}
        onReviewColumnSQL={reviewColumnSQL}
        editingIndex={editingIndex}
        setEditingIndex={setEditingIndex}
        onReviewIndexSQL={reviewIndexSQL}
        pendingAction={pendingAction}
        onClosePendingAction={() => setPendingAction(null)}
        onCopyPendingSQL={() => {
          if (!pendingAction) return
          navigator.clipboard.writeText(pendingAction.sql)
          showToast(t('common.sqlCopied'), 'success')
        }}
        onExecutePendingAction={executePendingAction}
      />
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
