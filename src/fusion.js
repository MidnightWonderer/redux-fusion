import { default as find } from 'lodash/fp/find'
import { default as get } from 'lodash/fp/get'
import { default as identity } from 'lodash/fp/identity'
import { default as unionBy } from 'lodash/fp/unionBy'
import * as React from 'react'
import { connect } from 'react-redux'
import { componentFromStreamWithConfig } from 'recompose/componentFromStream'
import { default as rxjsConfig } from 'recompose/rxjsObservableConfig'
import { default as shallowEqual } from 'recompose/shallowEqual'
import { BehaviorSubject } from 'rxjs/BehaviorSubject'
import { ReplaySubject } from 'rxjs/ReplaySubject'
import 'rxjs/add/operator/distinctUntilChanged'
import 'rxjs/add/operator/filter'
import 'rxjs/add/operator/let'
import 'rxjs/add/operator/map'
import 'rxjs/add/operator/publishBehavior'
import 'rxjs/add/operator/publishReplay'
import 'rxjs/add/operator/scan'

const namespece = 'ReduxFusion/'
const componentFromStream = componentFromStreamWithConfig(rxjsConfig)
const stateProxy = new ReplaySubject(1)
const stateKey = `${namespece}State`
const dispatchKey = `${namespece}Dispatch`
const stateSpy = (storeState) => ({ [stateKey]: storeState })
const dispatchSpy = (dispatch) => ({ [dispatchKey]: dispatch })
const connectSpy = connect(stateSpy, dispatchSpy)
const selectKey = get(['key'])
const unwrapState = get(['state'])
const allState$ = stateProxy
  .scan((allState, updatingState) =>
    unionBy(selectKey, [updatingState], allState),
    [],
  )
  .publishBehavior([])
  .refCount()

const mutableStateCache = []
const getStateForKey = (key) => {
  const cached = find({ key }, mutableStateCache)
  if (cached) {
    return cached.state$
  }
  const selectedState$ = allState$
    .map(find({ key }))
    .filter(identity)
    .map(unwrapState)
    .distinctUntilChanged()
    .publishReplay(1)
    .refCount()
  mutableStateCache.push({
    key,
    state$: selectedState$,
  })
}

const fuse = (connectHandler) => (Component) => {
  const applyPropsStream = (applyingProps) => <Component {...applyingProps}/>
  class AdapterComponent extends React.Component {
    constructor(props) {
      super(props)
      const {
        [dispatchKey]: dispatch,
        [stateKey]: storeState,
        ...pureProps,
      } = props
      // in order to make redux-fusion reusable
      // across multiple store we assign dispatch as key
      // and use it to distinguish between each store
      stateProxy.next({ key: dispatch, state: storeState })
      const state$ = getStateForKey(dispatch)
      const propsProxy = new BehaviorSubject(pureProps)
      const propsHandler = connectHandler(state$, dispatch)
      const transformedProps$ = propsProxy
        .distinctUntilChanged(shallowEqual)
        .let(propsHandler)
        .distinctUntilChanged(shallowEqual)
      this.propsProxy = propsProxy
      this.InnerComponent = componentFromStream(
        () => transformedProps$.map(applyPropsStream),
      )
    }

    componentWillReceiveProps(nextProps) {
      // eslint-disable-next-line no-unused-vars
      const {
        [dispatchKey]: dispatch,
        [stateKey]: storeState,
        ...pureProps,
      } = nextProps
      stateProxy.next({ key: dispatch, state: storeState })
      this.propsProxy.next(pureProps)
    }

    shouldComponentUpdate() {
      return false
    }

    propsProxy
    InnerComponent

    render() {
      const { InnerComponent } = this
      return <InnerComponent/>
    }
  }

  return connectSpy(AdapterComponent)
}

export default fuse
