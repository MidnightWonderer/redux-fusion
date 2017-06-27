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

// recompose config
const componentFromStream = componentFromStreamWithConfig(rxjsConfig)

// connect spying
const namespece = 'ReduxFusion/'
const stateProxy = new ReplaySubject(1)
const stateKey = `${namespece}State`
const dispatchKey = `${namespece}Dispatch`
const stateSpy = (storeState) => ({ [stateKey]: storeState })
const dispatchSpy = (dispatch) => ({ [dispatchKey]: dispatch })
const connectSpy = connect(stateSpy, dispatchSpy)

// multiple state management
//   since redux-fusion can be used
//   across multiple redux store
//   we will distinguish between each store by key
//   and store state of each store separately
const selectKey = get(['key'])
const unwrapState = get(['state'])
const allState$ = stateProxy
  // hope shallowEqual is cheaper than unionBy,
  // and other affected operations inside state stream
  // at least for the common case
  // where we are dealing with a single store
  .distinctUntilChanged(shallowEqual)
  .scan((allState, updatingState) =>
      unionBy(selectKey, [updatingState], allState),
    // since we use array to store multiple states from stores
    // time complexity of redux-fusion will be O(n) where n is the amount of stores
    // in common cases there should be only a single store
    // in some rare cases there might be a few of them
    // we just assume no applications need to create tons of store
    [],
  )
  .publishBehavior([])
  .refCount()
const mutableStateCache = []
const stateStreamForKey = (key) => {
  // we don't curry find here to speed up cache look up even if
  // we use the currying version of find later in this function
  const cached = find({ key }, mutableStateCache)
  if (cached) {
    return cached.state$
  }
  const selectedState$ = allState$
    .map(find({ key }))
    .filter(identity) // filter out undefined returned from find
    .map(unwrapState)
    .distinctUntilChanged()
    .publishReplay(1)
    .refCount()
  mutableStateCache.push({
    key,
    state$: selectedState$,
  })
  return selectedState$
}

const fuse = (fuseHandler) => (Component) => {
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
      // and use it to distinguish between state of each store
      stateProxy.next({ key: dispatch, state: storeState })
      const state$ = stateStreamForKey(dispatch)
      const propsProxy = new BehaviorSubject(pureProps)
      const props$ = propsProxy.distinctUntilChanged(shallowEqual);
      const transformedProps$ = fuseHandler(
        state$,
        props$,
        dispatch,
      ).distinctUntilChanged(shallowEqual)
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
