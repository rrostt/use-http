import { useEffect, useState, useCallback, useRef /*, useContext */ } from 'react'
import {
  HTTPMethod,
  UseFetch,
  ReqMethods,
  Req,
  Res,
  UseFetchArrayReturn,
  UseFetchObjectReturn,
  UseFetchArgs
} from './types'
import { BodyOnly, FetchData, NoArgs } from './types'
import useFetchArgs from './useFetchArgs'
import useSSR from 'use-ssr'
import makeFetchArgs from './makeFetchArgs'
// import { SimpleCache, createResource } from 'simple-cache-provider'
import { isEmpty, invariant } from './utils'


const responseMethods = ['clone', 'error', 'redirect', 'arrayBuffer', 'blob', 'formData', 'json', 'text']

const makeResponseProxy = (res = {}) => new Proxy(res, {
  get: (httpResponse: any, key: string) => {
    if (responseMethods.includes(key)) return () => httpResponse.current[key]()
    return (httpResponse.current || {})[key]
  }
})

// CACHE!
let responsesCache = new Map();
let pendingRequestsCache = new Map();
// function createResource(promise, getKey = x => x) {
//   return {
//     read(obj) {
//       console.log('CACHE', cache)
//       const key = getKey(obj);
//       console.log('OBJ', obj)
//       console.log('KEY', key)
//       console.log('CASH HAS KEY', cache.has(key))
//       if (cache.has(key)) {
//         console.log('cache hit', cache.get(key));
//         return cache.get(key);
//       }
//       if (pending.has(key)) {
//         console.log('pending hit', pending.get(key));
//         throw pending.get(key);
//       }
//       console.log('cache miss');
//       let p = promise(obj).then(val => {
//         pending.delete(key);
//         cache.set(key, val);
//       });
//       pending.set(key, p);
//       throw p;
//     },
//     flush() {
//       cache = new Map();
//       pending = new Map();
//     },
//     refetch(key) {
//       cache.delete(key);
//       this.read(key);
//     },
//   };
// }
// interface FetchCache {
//   bodyUsed?: boolean;
//   contentType?: null | string;
//   fetch?: Promise<void>;
//   error?: any;
//   headers?: Headers;
//   init: RequestInit | undefined;
//   input: RequestInfo;
//   ok?: boolean;
//   redirected?: boolean;
//   response?: any;
//   status?: number;
//   statusText?: string;
//   url?: string;
// }

// const caches: FetchCache[] = [];


const sleep = (ms = 0) => new Promise(r => setTimeout(r, ms))

// const caches = []


function useFetch<TData = any>(...args: UseFetchArgs): UseFetch<TData> {
  const { customOptions, requestInit, defaults } = useFetchArgs(...args)
  const {
    url: initialURL,
    onMount,
    onUpdate,
    path,
    interceptors,
    timeout,
    retries,
    onTimeout,
    onAbort,
    suspense,
    // cachePolicy
  } = customOptions
  // const cache = useContext(SimpleCache)

  const { isServer } = useSSR()

  const controller = useRef<AbortController>()
  const res = useRef<Res<TData>>({} as Res<TData>)
  const data = useRef<TData>(defaults.data)
  const timedout = useRef(false)
  const attempts = useRef(retries)

  const [loading, setLoading] = useState(defaults.loading)
  const [error, setError] = useState<any>()

  const makeFetch = useCallback((method: HTTPMethod /*, isSuspense?: boolean = false */): FetchData => {

    let promise: any
    // The requestKeys are used to identify duplicate requests.
    let requestKey: any

    const customFetch = async (url: string, options: any): Promise<any> => {
      console.log('------- custom fetch start --------')
      if (!loading) setLoading(true)
      if (error) setError(undefined)

      const timer = timeout > 0 && setTimeout(() => {
        timedout.current = true;
        // theController.abort()
        // (controller.current as AbortController).abort()
        request.abort()
        if (onTimeout) onTimeout()
      }, timeout)

      let theData
      let theRes

      try {
        pendingRequestsCache.set(requestKey, promise)
        console.log('requestKey', requestKey)
        console.log('promise', promise)
        console.log('pending req cache', pendingRequestsCache)
        theRes = await fetch(url, options) as Res<TData>
        // console.log('res', theRes)
        res.current = theRes.clone()

        try {
          theData = await theRes.json()
        } catch (err) {
          theData = (await theRes.text()) as any // FIXME: should not be `any` type
        }

        theData = (defaults.data && isEmpty(theData)) ? defaults.data : theData
        theRes.data = theData
        res.current.data = theData

        res.current = interceptors.response ? interceptors.response(res.current) : res.current
        invariant('data' in res.current, 'You must have `data` field on the Response returned from your `interceptors.response`')
        data.current = res.current.data as TData

      } catch (err) {
        console.log('error', err)
        if (attempts.current > 0) return customFetch(url, options)
        if (attempts.current < 1 && timedout.current) setError({ name: 'AbortError', message: 'Timeout Error' })
        if (err.name !== 'AbortError') setError(err)

      } finally {
        if (attempts.current > 0) attempts.current -= 1
        timedout.current = false
        if (timer) clearTimeout(timer)
        controller.current = undefined

        // console.log('data', theData)
        pendingRequestsCache.delete(requestKey)
        responsesCache.set(requestKey, res.current)

        setLoading(false)
      }
      return data.current
    }

    const doFetch = async (
      routeOrBody?: string | BodyInit | object,
      body?: BodyInit | object,
    ): Promise<any> => {
      console.log('------- do fetch start --------')
      if (isServer) return // for now, we don't do anything on the server
      controller.current = new AbortController()
      controller.current.signal.onabort = onAbort
      const theController = controller.current

      let { url, options } = await makeFetchArgs(
        requestInit,
        method,
        theController,
        initialURL,
        path,
        routeOrBody,
        body,
        interceptors.request
      )

      requestKey = Object.entries({ url, method, body: options.body || ''})
        .map(([key, value]) => `${key}:${value}`).join('||')
      promise = async () => await customFetch(url, options)
      // console.log('PROMISE: ', promise)

      console.log('finished response cache', responsesCache)
      if (responsesCache.has(requestKey)) {
        console.log('in cache', responsesCache.get(requestKey))
        return responsesCache.get(requestKey)
      }

      console.log('pending request cache', pendingRequestsCache)
      if (pendingRequestsCache.has(requestKey)) {
        console.log('is pending', pendingRequestsCache.get(requestKey))
        if (suspense) throw pendingRequestsCache.get(requestKey)
        return await pendingRequestsCache.get(requestKey)
      }

      // pendingRequestsCache.set(requestKey, promise)

      const responseData = await promise()
      console.log('response data', responseData)
      return responseData
    }
    // return doFetch
    // const test = createResource(doFetch).read()
    // console.log('TEST: ', test)
    // return (...args) => createResource(doFetch(...args)).read(...args) as any
    // return createResource(doFetch)(cache)
    return doFetch

  }, [initialURL, requestInit, isServer])

  const post = makeFetch(HTTPMethod.POST)
  const del = makeFetch(HTTPMethod.DELETE)

  const request: Req<TData> = {
    get: makeFetch(HTTPMethod.GET),
    post,
    patch: makeFetch(HTTPMethod.PATCH),
    put: makeFetch(HTTPMethod.PUT),
    del,
    delete: del,
    abort: () => controller.current && controller.current.abort(),
    query: (query, variables) => post({ query, variables }),
    mutate: (mutation, variables) => post({ mutation, variables }),
    loading: loading as boolean,
    error,
    data: data.current,
  }

  const executeRequest = useCallback(() => {
    const methodName = requestInit.method || HTTPMethod.GET
    const methodLower = methodName.toLowerCase() as keyof ReqMethods
    if (methodName !== HTTPMethod.GET) {
      const req = request[methodLower] as BodyOnly
      req(requestInit.body as BodyInit)
    } else {
      const req = request[methodLower] as NoArgs
      req()
    }
  }, [requestInit.body, requestInit.method])

  const mounted = useRef(false)

  // handling onUpdate
  useEffect((): void => {
    if (onUpdate.length === 0 || !mounted.current) return
    executeRequest()
  }, [...onUpdate, executeRequest])

  // handling onMount
  useEffect((): void => {
    if (mounted.current) return
    mounted.current = true
    if (!onMount) return
    executeRequest()
  }, [onMount, executeRequest])

  // handling onUnMount
  // Cancel any running request when unmounting to avoid updating state after component has unmounted
  // This can happen if a request's promise resolves after component unmounts
  useEffect(() => request.abort, [])

  return Object.assign<UseFetchArrayReturn<TData>, UseFetchObjectReturn<TData>>(
    [request, makeResponseProxy(res), loading as boolean, error],
    { request, response: makeResponseProxy(res), ...request },
  )
}

export { useFetch }
export default useFetch
