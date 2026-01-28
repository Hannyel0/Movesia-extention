import { nanoid } from 'nanoid'
import { create, StateCreator } from 'zustand'
import { persist, createJSONStorage, PersistStorage } from 'zustand/middleware'
import VSCodeAPI from '../VSCodeAPI'

/**
 * Creates a Zustand store which is automatically persisted to VS Code state.
 *
 * @export
 * @template TState
 * @param {string} name A globally-unique name for the store.
 * @param {StateCreator<TState>} createState A function which creates the initial state.
 * @return {*}  Zustand store hook
 */
export default function createVSCodeZustand<TState>(
  name: string,
  createState: StateCreator<TState, [], []>
) {
  return create<TState>()(
    persist(createState, {
      name,
      storage: createJSONStorage(() => VSCodeStateStorage),
    })
  )
}

const VSCodeStateStorage: PersistStorage<unknown> = {
  getItem: (name: string) => {
    const state = VSCodeAPI.getState()
    return state?.[name] ?? null
  },
  setItem: (name: string, value: unknown) => {
    VSCodeAPI.setState({
      ...VSCodeAPI.getState(),
      [name]: value,
    })
  },
  removeItem: (name: string) => {
    const state = VSCodeAPI.getState()
    if (state) {
      delete state[name]
      VSCodeAPI.setState(state)
    }
  },
}
