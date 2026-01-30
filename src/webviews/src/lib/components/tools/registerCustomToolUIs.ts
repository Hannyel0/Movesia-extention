/**
 * Tool UI Registration
 *
 * This file registers all custom tool UI components with the registry.
 * Import and call registerCustomToolUIs() at app startup.
 *
 * ## How to add a new custom tool UI:
 *
 * 1. Create your component in ./custom/MyToolUI.tsx:
 *    ```tsx
 *    import type { ToolUIProps } from '../types'
 *
 *    interface MyInput { action: string }
 *    interface MyOutput { result: string }
 *
 *    export function MyToolUI({ input, output, isActive }: ToolUIProps<MyInput, MyOutput>) {
 *      // Your custom rendering logic
 *      return <div>...</div>
 *    }
 *    ```
 *
 * 2. Export it from ./custom/index.ts:
 *    ```ts
 *    export { MyToolUI } from './MyToolUI'
 *    ```
 *
 * 3. Register it below in registerCustomToolUIs():
 *    ```ts
 *    registerToolUI('my_tool_name', {
 *      config: {
 *        displayName: 'My Tool',
 *        color: 'text-pink-400',
 *        category: 'mutation',
 *      },
 *      component: MyToolUI,
 *    })
 *    ```
 *
 * That's it! The tool will automatically use your custom UI.
 */

import { registerToolUI } from './registry'
import { UnityQueryUI, UnityHierarchyUI, UnityRefreshUI } from './custom'

/**
 * Register all custom tool UIs.
 * Call this once at app initialization.
 */
export function registerCustomToolUIs(): void {
  // Unity Query - The Observer
  registerToolUI('unity_query', {
    config: {
      displayName: 'Query Unity',
      color: 'text-blue-400',
      category: 'query',
      description: 'Read the current state of the Unity Editor',
    },
    component: UnityQueryUI,
  })

  // Unity Hierarchy - The Architect
  registerToolUI('unity_hierarchy', {
    config: {
      displayName: 'Modify Hierarchy',
      color: 'text-green-400',
      category: 'mutation',
      description: 'Manage GameObject structure in the scene',
    },
    component: UnityHierarchyUI,
  })

  // Unity Refresh - The Compiler
  registerToolUI('unity_refresh', {
    config: {
      displayName: 'Refresh Assets',
      color: 'text-yellow-400',
      category: 'system',
      description: 'Trigger Unity asset database refresh',
    },
    component: UnityRefreshUI,
  })

  // Other tools use default UI (can be customized later)
  // - unity_component
  // - unity_prefab
  // - unity_scene
}

/**
 * Check if custom UIs have been registered
 */
let _registered = false

export function ensureCustomToolUIsRegistered(): void {
  if (!_registered) {
    registerCustomToolUIs()
    _registered = true
  }
}
