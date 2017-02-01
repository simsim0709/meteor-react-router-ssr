import React from 'react';

import {
  match as ReactRouterMatch,
  RouterContext,
  createMemoryHistory,
} from 'react-router';

import ReactDOMServer from 'react-dom/server';
// import cookieParser from 'cookie-parser';

import { FastRender } from 'meteor/staringatlights:fast-render';
import { InjectData } from 'meteor/staringatlights:inject-data';

import SsrContextData from './ssr_context';
import patchSubscribeData from './ssr_data';

import {
  setCachePage,
  getCachePage,
  hasCachePage,
} from './cache';

class ReactRouterSSR {
  constructor() {
    // we're stealing all the code from FlowRouter SSR
    // https://github.com/kadirahq/flow-router/blob/ssr/server/route.js#L61
    this.ssrContextData = new SsrContextData();
    this.ssrContext = new Meteor.EnvironmentVariable();
    this.inSubscription = new Meteor.EnvironmentVariable();
    this.Run = this.Run.bind(this);
  }

  Run(routes, clientOptions = {}, serverOptions = {}) {
    // this line just patches Subscribe and find mechanisms
    patchSubscribeData(this);

    Meteor.bindEnvironment(() => {
      // WebApp.rawConnectHandlers.use(cookieParser());

      WebApp.connectHandlers.use(Meteor.bindEnvironment((req, res, next) => {
        this.req = req;
        this.res = res;
        this.next = next;
        this.routes = routes;
        this.clientOptions = clientOptions;
        this.serverOptions = serverOptions;

        if (!isAppUrl(req)) {
          return next();
        }

        if (isUrlsDisabledSSR(serverOptions.disabledSSRPaths, req.url)) {
          return next();
        }

        this.handleRequestByReactRouter();
      }));
    })();
  }

  handleRequestByReactRouter() {
    // const loginToken = this.req.cookies.meteor_login_token;
    const loginToken = undefined;
    const headers = this.req.headers;
    const context = new FastRender._Context(loginToken, { headers });

    FastRender.frContext.withValue(context, () => {
      const history = createMemoryHistory(this.req.url);

      ReactRouterMatch({
        history,
        routes: this.routes,
        location: this.req.url,
      }, Meteor.bindEnvironment((err, redirectLocation, renderProps) => {
        console.time('ReactRouterSSR Run');
        if (err) {
          handleError(err, this.res);
        } else if (redirectLocation) {
          handleRedirect(redirectLocation, this.res);
        } else if (renderProps) {
          this.renderProps = renderProps;
          this.handleSuccess();
        } else {
          handleNotFound(this.res);
        }
        console.timeEnd('ReactRouterSSR Run');
      }));
    });
  }

  handleSuccess() {
    let html;
    let frData;

    if (hasCachePage(this.req.url)) {
      const cachedPage = getCachePage(this.req.url);
      html = cachedPage.html;
      frData = cachedPage.frData;
    } else {
      const rendered = this.renderHtml();
      html = rendered.html;
      frData = rendered.frData;
    }

    InjectData.pushData(this.res, 'fast-render-data', frData);

    this.res.write = this.patchResWrite(html);
    this.next();
  }

  renderHtml() {
    let html;
    let frData;

    this.ssrContext.withValue(this.ssrContextData, () => {
      try {
        if (!this.serverOptions.disableSSR) {
          const app = (
            <RouterContext
              {...this.renderProps}
              {...this.serverOptions.props}
            />
          );

          html = ReactDOMServer.renderToString(app);
          frData = this.createFrData();
        }
      } catch (ex) {
        console.error(`Error when doing SSR. path:${this.req.url}: ${ex.message}`);
        console.error(ex.stack);
      }
    });

    if (this.serverOptions.shouldCache) {
      setCachePage(this.req.url, { html, frData });
    }

    return { html, frData };
  }

  patchResWrite(html) {
    const self = this;
    const originalWrite = this.res.write;

    return function (data) {
      if (typeof data === 'string' && data.indexOf('<!DOCTYPE html>') === 0) {
        let rootElementAttributes = '';
        const attributes = self.clientOptions.rootElementAttributes instanceof Array ? self.clientOptions.rootElementAttributes : [];
        if (attributes[0] instanceof Array) {
          for (let i = 0; i < attributes.length; i++) {
            rootElementAttributes = `${rootElementAttributes} ${attributes[i][0]}="${attributes[i][1]}"`;
          }
        } else if (attributes.length > 0) {
          rootElementAttributes = ` ${attributes[0]}="${attributes[1]}"`;
        }

        data = data.replace('<body>', `<body><${self.clientOptions.rootElementType || 'div'} id="${self.clientOptions.rootElement || 'react-app'}"${rootElementAttributes}>${html}</${self.clientOptions.rootElementType || 'div'}>`);
      }

      originalWrite.call(this, data);
    };
  }

  createFrData() {
    const frData = InjectData.getData(this.res, 'fast-render-data');

    if (frData) {
      this.ssrContextData.addData(frData.collectionData);
    }

    // I'm pretty sure this could be avoided in a more elegant way?
    const context = FastRender.frContext.get();
    const data = context.getData();

    return data;
  }
}

const reactRouterSsr = new ReactRouterSSR();

export default reactRouterSsr;

function isUrlsDisabledSSR(urls, reqUrl) {
  return urls && Array.isArray(urls) && urls.some(url => reqUrl.startsWith(url));
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
