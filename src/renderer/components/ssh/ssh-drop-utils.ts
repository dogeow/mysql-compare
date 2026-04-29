import type { SSHUploadEntry } from '../../../shared/types'

type LocalPathResolver = (file: File) => string

interface WebkitDataTransferItem {
  webkitGetAsEntry?: () => WebkitFileSystemEntry | null
}

interface WebkitFileSystemEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
}

interface WebkitFileSystemFileEntry extends WebkitFileSystemEntry {
  isFile: true
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void
}

interface WebkitFileSystemDirectoryReader {
  readEntries: (
    success: (entries: WebkitFileSystemEntry[]) => void,
    error?: (error: DOMException) => void
  ) => void
}

interface WebkitFileSystemDirectoryEntry extends WebkitFileSystemEntry {
  isDirectory: true
  createReader: () => WebkitFileSystemDirectoryReader
}

export async function getDroppedUploadEntries(
  dataTransfer: DataTransfer,
  resolveLocalPath: LocalPathResolver
): Promise<SSHUploadEntry[]> {
  const rootEntries = Array.from(dataTransfer.items ?? [])
    .map((item) => (item as WebkitDataTransferItem).webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is WebkitFileSystemEntry => !!entry)

  const collected = rootEntries.length > 0 ? await collectEntryTree(rootEntries, resolveLocalPath) : []
  if (collected.length > 0) return dedupeUploadEntries(collected)

  const files = Array.from(dataTransfer.files ?? [])
  return dedupeUploadEntries(
    files.flatMap((file) => {
      const localPath = resolveLocalPath(file)
      if (!localPath) return []
      return [{ type: 'file', localPath, relativePath: file.name } satisfies SSHUploadEntry]
    })
  )
}

async function collectEntryTree(
  rootEntries: WebkitFileSystemEntry[],
  resolveLocalPath: LocalPathResolver
): Promise<SSHUploadEntry[]> {
  const entries: SSHUploadEntry[] = []

  for (const entry of rootEntries) {
    await collectEntry(entry, '', resolveLocalPath, entries)
  }

  return entries
}

async function collectEntry(
  entry: WebkitFileSystemEntry,
  parentPath: string,
  resolveLocalPath: LocalPathResolver,
  entries: SSHUploadEntry[]
): Promise<void> {
  const relativePath = joinRelativePath(parentPath, entry.name)

  if (entry.isDirectory) {
    entries.push({ type: 'directory', relativePath })
    const children = await readAllDirectoryEntries(entry as WebkitFileSystemDirectoryEntry)
    for (const child of children) {
      await collectEntry(child, relativePath, resolveLocalPath, entries)
    }
    return
  }

  if (!entry.isFile) return

  const file = await readFileEntry(entry as WebkitFileSystemFileEntry)
  const localPath = resolveLocalPath(file)
  if (!localPath) return

  entries.push({ type: 'file', localPath, relativePath })
}

function readFileEntry(entry: WebkitFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

async function readAllDirectoryEntries(entry: WebkitFileSystemDirectoryEntry): Promise<WebkitFileSystemEntry[]> {
  const reader = entry.createReader()
  const allEntries: WebkitFileSystemEntry[] = []

  for (;;) {
    const batch = await new Promise<WebkitFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    if (batch.length === 0) return allEntries
    allEntries.push(...batch)
  }
}

function joinRelativePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name
}

function dedupeUploadEntries(entries: SSHUploadEntry[]): SSHUploadEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.type}:${entry.relativePath}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}