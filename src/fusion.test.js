import React from 'react'
import assert from 'assert'
import jsdom from 'jsdom'
import { createStore } from 'redux'
import { mount } from 'enzyme'
import { Observable } from 'rxjs'
import fuse from './fusion'

const doc = jsdom.jsdom('<!doctype html><html><body></body></html>')
global.document = doc
global.window = doc.defaultView

const mocks = () => {
  const mockHandler = (state$, props$) =>
    Observable.combineLatest(
      state$,
      props$,
      (state, props) => ({ state, props }),
    )
  const mockStore = createStore(() => null);
  return {
    mockHandler,
    mockStore
  }
}

describe('fusion', () => {
  it('should render the wrapped component', () => {
    const { mockHandler, mockStore } = mocks()
    const WrappedComponent = () => <div />
    const FusedComponent = fuse(mockHandler)(WrappedComponent)
    const enz = mount(
      <FusedComponent />,
      { context: { store: mockStore } }
    )
    assert.equal(enz.find('div').length, 1, 'wrapper div rendered')
  })
})
