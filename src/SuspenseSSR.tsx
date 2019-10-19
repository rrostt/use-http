import React, { Suspense, SuspenseProps /*, useContext */} from 'react';
// import { SSRContext } from './SSRContext';
import useSSR from 'use-ssr'

export const unstable_SuspenseSSR = ({ children, fallback }: SuspenseProps) => {
  // const ssrManager = useContext(SSRContext);

  // return ssrManager ? (
  const { isServer } = useSSR()
  return isServer ? (
    <>{children}</>
  ) : (
    <Suspense fallback={fallback}>{children}</Suspense>
  );
}