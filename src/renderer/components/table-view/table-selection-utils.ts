export interface ToggleRowSelectionOptions {
  selected: ReadonlySet<number>
  rowIndex: number
  anchorIndex: number | null
  shiftKey: boolean
}

export interface ToggleRowSelectionResult {
  selected: Set<number>
  anchorIndex: number
}

export function toggleRowSelection({
  selected,
  rowIndex,
  anchorIndex,
  shiftKey
}: ToggleRowSelectionOptions): ToggleRowSelectionResult {
  if (shiftKey && anchorIndex !== null) {
    const nextSelected = new Set(selected)
    const start = Math.min(anchorIndex, rowIndex)
    const end = Math.max(anchorIndex, rowIndex)

    for (let index = start; index <= end; index += 1) {
      nextSelected.add(index)
    }

    return {
      selected: nextSelected,
      anchorIndex: rowIndex
    }
  }

  const nextSelected = new Set(selected)
  if (nextSelected.has(rowIndex)) {
    nextSelected.delete(rowIndex)
  } else {
    nextSelected.add(rowIndex)
  }

  return {
    selected: nextSelected,
    anchorIndex: rowIndex
  }
}