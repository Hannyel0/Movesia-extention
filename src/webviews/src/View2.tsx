import React, { FunctionComponent } from 'react'
import { SiGithub } from 'react-icons/si'
import { useShallow } from 'zustand/react/shallow'
import useAppState from './appState'
import Toggle from './lib/components/Toggle'

type View2Props = {}

const View2: FunctionComponent<View2Props> = props => {
  const [toggle1, setToggle1] = useAppState(
    useShallow(state => [state.toggle1, state.setToggle1])
  )
  const [toggle2, setToggle2] = useAppState(
    useShallow(state => [state.toggle2, state.setToggle2])
  )
  return (
    <div>
      <h1>
        <SiGithub /> View2
        <Toggle
          checked={toggle1}
          label="Toggle 1"
          handleChange={setToggle1}
          title="Toggle 1 Title"
        />
        <Toggle
          checked={toggle2}
          label="Toggle 2"
          handleChange={setToggle2}
          title="Toggle 2 Title"
        />
      </h1>
    </div>
  )
}

export default View2
