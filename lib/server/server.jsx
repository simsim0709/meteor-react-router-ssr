import React from 'react';

import {
  match as ReactRouterMatch,
  RouterContext,
  createMemoryHistory,
} from 'react-router';

import SsrContext from './ssr_context';
import patchSubscribeData from './ssr_data';

import {
  setCachePage,
  getCachePage,
  hasCachePage,
  writeFromCache,
} from './cache';

import ReactDOMServer from 'react-dom/server';
import cookieParser from 'cookie-parser';

const ReactRouterSSR = {};

export default ReactRouterSSR;

// creating some EnvironmentVariables that will be used later on
ReactRouterSSR.ssrContext = new Meteor.EnvironmentVariable();
ReactRouterSSR.inSubscription = new Meteor.EnvironmentVariable(); // <-- needed in ssr_data.js

function isUrlsDisabledSSR(urls, reqUrl) {
  return urls && Array.isArray(urls) && urls.some(url => reqUrl.startsWith(url));
}

ReactRouterSSR.Run = (routes, clientOptions = {}, serverOptions = {}) => {
  // this line just patches Subscribe and find mechanisms
  patchSubscribeData(ReactRouterSSR);

  Meteor.bindEnvironment(() => {
    WebApp.rawConnectHandlers.use(cookieParser());

    WebApp.connectHandlers.use(Meteor.bindEnvironment((req, res, next) => {
      if (!isAppUrl(req)) {
        next();
        return;
      }

      if (isUrlsDisabledSSR(serverOptions.disabledSSRPaths, req.url)) {
        next();
        return;
      }

      const loginToken = undefined;
      const headers = req.headers;
      const context = new FastRender._Context(loginToken, { headers });

      FastRender.frContext.withValue(context, () => {
        handleRequestByReactRouter(routes, req, res, next, { clientOptions, serverOptions });
      });
    }));
  })();
};

function handleRequestByReactRouter(routes, req, res, next, { clientOptions, serverOptions }) {
  const history = createMemoryHistory(req.url);

  ReactRouterMatch({
    history,
    routes,
    location: req.url,
  }, Meteor.bindEnvironment((err, redirectLocation, renderProps) => {
    if (err) {
      handleError(err, res);
    } else if (redirectLocation) {
      handleRedirect(redirectLocation, res);
    } else if (renderProps) {
      handleSuccess({
        clientOptions,
        serverOptions,
        req,
        res,
        next,
        renderProps,
      });
    } else {
      handleNotFound(res);
    }
  }));
}

function handleError(error, res) {
  res.writeHead(500);
  res.write(error.message);
  res.end();
}

function handleRedirect(redirect, res) {
  res.writeHead(302, { Location: redirect.pathname + redirect.search });
  res.end();
}

function handleNotFound(res) {
  res.writeHead(404);
  res.write('<h1>404 Not Found</h1>');
  res.end();
}

function handleSuccess({
  userId,
  clientOptions,
  serverOptions,
  req,
  res,
  next,
  renderProps,
}) {
  const html = generateSSRData({
    clientOptions,
    serverOptions,
    req,
    res,
    renderProps,
  });

  res.write = patchResWrite({
    userId,
    clientOptions,
    serverOptions,
    html,
    originalWrite: res.write,
    reqUrl: req.url,
  });

  next();
}

function patchResWrite({
  userId,
  clientOptions,
  serverOptions,
  originalWrite,
  html,
  reqUrl,
}) {
  return function (data) {
    if (typeof data === 'string' && data.indexOf('<!DOCTYPE html>') === 0) {
      // if (!serverOptions.dontMoveScripts) {
      //   data = moveScripts(data);
      // }

      if (typeof serverOptions.htmlHook === 'function') {
        data = serverOptions.htmlHook(data);
      }

      let rootElementAttributes = '';
      const attributes = clientOptions.rootElementAttributes instanceof Array ? clientOptions.rootElementAttributes : [];
      if (attributes[0] instanceof Array) {
        for (let i = 0; i < attributes.length; i++) {
          rootElementAttributes = `${rootElementAttributes} ${attributes[i][0]}="${attributes[i][1]}"`;
        }
      } else if (attributes.length > 0) {
        rootElementAttributes = ` ${attributes[0]}="${attributes[1]}"`;
      }

      data = data.replace('<body>', `<body><${clientOptions.rootElementType || 'div'} id="${clientOptions.rootElement || 'react-app'}"${rootElementAttributes}>${html}</${clientOptions.rootElementType || 'div'}>`);
    }

    originalWrite.call(this, data);
  };
}

function generateSSRData({
  clientOptions,
  serverOptions,
  req,
  res,
  renderProps,
}) {
  let html;

  // we're stealing all the code from FlowRouter SSR
  // https://github.com/kadirahq/flow-router/blob/ssr/server/route.js#L61
  const ssrContext = new SsrContext();

  ReactRouterSSR.ssrContext.withValue(ssrContext, () => {
    try {
      const frData = InjectData.getData(res, 'fast-render-data');
      // console.log('frData', frData.collectionData);
      if (frData) {
        ssrContext.addData(frData.collectionData);
      }
      if (serverOptions.preRender) {
        serverOptions.preRender(req, res);
      }

      // Uncomment these two lines if you want to easily trigger
      // multiple client requests from different browsers at the same time

      // console.log('sarted sleeping');
      // Meteor._sleepForMs(5000);
      // console.log('ended sleeping');

      renderProps = {
        ...renderProps,
        ...serverOptions.props,
      };

      if (!serverOptions.disableSSR) {
        console.time('REACT_RENDER_TO_STRING');

        let app = <RouterContext {...renderProps} />;

        if (typeof clientOptions.wrapperHook === 'function') {
          app = clientOptions.wrapperHook(app);
        }

        console.log('RENDER_TO_STRING');
        html = ReactDOMServer.renderToString(app);

        // if (hasCachePage(req.url)) {
        //   console.log('RENDER_CACHED_PAGE');
        //   const cachedPage = getCachePage(req.url);
        //   html = cachedPage;
        // } else {
        //   let app = <RouterContext {...renderProps} />;
        //
        //   if (typeof clientOptions.wrapperHook === 'function') {
        //     app = clientOptions.wrapperHook(app);
        //   }
        //
        //   console.log('RENDER_TO_STRING');
        //   html = ReactDOMServer.renderToString(app);
        //   if (serverOptions.shouldCache) {
        //     setCachePage(req.url, html);
        //   }
        // }

        // let app = <RouterContext {...renderProps} />;
        //
        // if (typeof clientOptions.wrapperHook === 'function') {
        //   app = clientOptions.wrapperHook(app);
        // }
        // console.log('RENDER_TO_STRING');
        // html = ReactDOMServer.renderToString(app);

        console.timeEnd('REACT_RENDER_TO_STRING');
      }

      if (typeof serverOptions.dehydrateHook === 'function') {
        InjectData.pushData(res, 'dehydrated-initial-data', JSON.stringify(serverOptions.dehydrateHook()));
      }

      if (serverOptions.postRender) {
        serverOptions.postRender(req, res);
      }

      // I'm pretty sure this could be avoided in a more elegant way?
      const context = FastRender.frContext.get();
      const data = context.getData();
      InjectData.pushData(res, 'fast-render-data', data);
    } catch (err) {
      console.error(new Date(), 'error while server-rendering', err.stack);
    }
  });

  return html;
}

function isAppUrl(req) {
  const url = req.url;
  if (url === '/favicon.ico' || url === '/robots.txt') {
    return false;
  }

  if (url === '/app.manifest') {
    return false;
  }

  // Avoid serving app HTML for declared routes such as /sockjs/.
  if (RoutePolicy.classify(url)) {
    return false;
  }
  return true;
}
