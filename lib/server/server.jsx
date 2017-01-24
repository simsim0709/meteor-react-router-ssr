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
  writeFromCache,
} from './cache';

// import SSRCaching from 'electrode-react-ssr-caching';
// import ReactDOMStream from 'react-dom-stream/server';
import ReactDOMServer from 'react-dom/server';
import cookieParser from 'cookie-parser';
// import Cheerio from 'cheerio';

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

    const loginToken = req.cookies.meteor_login_token;
    const headers = req.headers;
    const context = new FastRender._Context(loginToken, { headers });

    FastRender.frContext.withValue(context, () => {
      const userId = context.userId;
      let history = createMemoryHistory(req.url);

      if (typeof serverOptions.historyHook === 'function') {
        history = serverOptions.historyHook(history);
      }

      ReactRouterMatch({
        history,
        routes,
        location: req.url,
      }, (err, redirectLocation, renderProps) => {
        if (err) {
          res.writeHead(500);
          res.write(err.messages);
          res.end();
        } else if (redirectLocation) {
          res.writeHead(302, { Location: redirectLocation.pathname + redirectLocation.search });
          res.end();
        } else if (renderProps) {
          sendSSRHtml({
            userId,
            clientOptions,
            serverOptions,
            req,
            res,
            next,
            renderProps,
          });
        } else {
          res.writeHead(404);
          res.write('Not found');
          res.end();
        }
      });
    });
  }));
};

function sendSSRHtml({
  userId,
  clientOptions,
  serverOptions,
  req,
  res,
  next,
  renderProps,
}) {
  const cachedPage = getCachePage(userId, req.url);
  if (serverOptions.shouldCache && cachedPage) {
    console.log('RENDER_FROM_CACHE', userId, req.url);
    console.time('RENDER_FROM_CACHE_TIME');
    res.write = writeFromCache(res.write, cachedPage);
    console.timeEnd('RENDER_FROM_CACHE_TIME');
    // res.write(cachedPage);
  } else {
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
  }

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

    if (serverOptions.shouldCache) {
      setCachePage(userId, reqUrl, data);
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

      fetchComponentData(serverOptions, renderProps);
      let app = <RouterContext {...renderProps} />;

      if (typeof clientOptions.wrapperHook === 'function') {
        app = clientOptions.wrapperHook(app);
      }

      if (!serverOptions.disableSSR) {
        // SSRCaching.clearProfileData();

        console.time('react renderToString');
        // SSRCaching.enableProfiling();
        // html = ReactDOMStream.renderToString(app);
        html = ReactDOMServer.renderToString(app);
        // SSRCaching.enableProfiling(false);
        console.timeEnd('react renderToString');
        // console.log('SSRCaching.profileData', SSRCaching.profileData);
        // console.log(JSON.stringify(SSRCaching.profileData, null, 2));
      } else if (serverOptions.loadingScreen) {
        html = serverOptions.loadingScreen;
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

function fetchComponentData(serverOptions, renderProps) {
  const componentsWithFetch = renderProps.components
    .filter(component => !!component)
    .filter(component => component.fetchData);

  if (!componentsWithFetch.length) {
    return;
  }

  if (!Package.promise) {
    console.error("react-router-ssr: Support for fetchData() static methods on route components requires the 'promise' package.");
    return;
  }

  const promises = serverOptions.fetchDataHook(componentsWithFetch);
  Promise.awaitAll(promises);
}

// function moveScripts(data) {
//   const $ = Cheerio.load(data, {
//     decodeEntities: false,
//   });
//   const heads = $('head script');
//   $('body').append(heads);
//   $('head').html($('head').html().replace(/(^[ \t]*\n)/gm, ''));
//
//   return $.html();
// }

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