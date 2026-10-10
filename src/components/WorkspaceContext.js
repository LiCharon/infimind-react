import { createContext, useContext } from 'react'
import { translateWorkspace } from './workspace-language'

export const WorkspaceContext = createContext(null)

export function useWorkspaceLayout() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('Workspace pages must be rendered inside WorkspaceLayout')
  return value
}

export function useWorkspaceText() {
  const value = useContext(WorkspaceContext)
  return value?.t || ((text) => translateWorkspace(text, 'zh-CN'))
}
