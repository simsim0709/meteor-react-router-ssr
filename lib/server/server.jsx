import 'isomorphic-fetch';

import React from 'react';

import { match as ReactRouterMatch, RouterContext, createMemoryHistory } from 'react-router';

import ReactDOMServer from 'react-dom/server';
// import cookieParser from 'cookie-parser';

import { FastRender } from 'meteor/staringatlights:fast-render';
import { InjectData } from 'meteor/staringatlights:inject-data';

import SsrContextData from './ssr_context';
import patchSubscribeData from './ssr_data';

import { setCachePage, getCachePage, hasCachePage } from './cache';

import { renderToStringWithData } from 'react-apollo';
import { onPageLoad } from 'meteor/server-render';

onPageLoad(async sink => {
  try {
    const data = await reactRouterSsr.handleRequestByReactRouter(sink.request);

    if (data.dehydrate) {
      sink.appendToHead(
        `<script>window.__APOLLO_STATE__=${JSON.stringify({
          apollo: data.dehydrate,
        })}</script>`
      );
    }

    sink.renderIntoElementById('react-app', data.html);
  } catch (ex) {
    throw new Meteor.Error(500, ex);
  }
});

class ReactRouterSSR {
  constructor() {
    // we're stealing all the code from FlowRouter SSR
    // https://github.com/kadirahq/flow-router/blob/ssr/server/route.js#L61
    this.ssrContextData = new SsrContextData();
    this.ssrContext = new Meteor.EnvironmentVariable();
    this.inSubscription = new Meteor.EnvironmentVariable();
    this.Run = this.Run.bind(this);
    this.req = undefined;
    this.routes = undefined;
    this.clientOptions = undefined;
    this.serverOptions = undefined;
    this.renderProps = undefined;

    // this line just patches Subscribe and find mechanisms
    patchSubscribeData(this);
  }

  Run(routes, clientOptions = {}, serverOptions = {}) {
    this.routes = routes;
    this.clientOptions = clientOptions;
    this.serverOptions = serverOptions;
  }

  handleRequestByReactRouter(req) {
    this.req = req;

    return new Promise((resolve, reject) => {
      if (!isAppUrl(req)) {
        return reject(false);
      }

      if (isUrlsDisabledSSR(this.serverOptions.disabledSSRPaths, req.url)) {
        return reject(false);
      }

      // const loginToken = this.req.cookies.meteor_login_token;
      const loginToken = undefined;
      // const headers = this.req.headers;
      const context = new FastRender._Context(loginToken, {});

      FastRender.frContext.withValue(context, () => {
        const history = createMemoryHistory(this.req.url.pathname);

        ReactRouterMatch(
          {
            history,
            routes: this.routes,
            location: this.req.url.pathname,
          },
          (err, redirectLocation, renderProps) => {
            console.time('ReactRouterSSR Run');
            if (err) {
              return reject(err);
            } else if (redirectLocation) {
              return resolve(handleRedirect(redirectLocation));
            } else if (renderProps) {
              this.renderProps = renderProps;
              return resolve(this.handleSuccess());
            } else {
              resolve(handleNotFound());
            }
            console.timeEnd('ReactRouterSSR Run');
          }
        );
      });
    });
  }

  handleSuccess() {
    let html;
    let frData;

    if (hasCachePage(this.req.url.pathname)) {
      const cachedPage = getCachePage(this.req.url.pathname);
      html = cachedPage.html;
      frData = cachedPage.frData;
    } else {
      return this.renderHtml();
    }
  }

  renderHtml() {
    let html;
    let frData;
    let dehydrate;

    return new Promise((resolve, reject) => {
      this.ssrContext.withValue(this.ssrContextData, () => {
        try {
          if (!this.serverOptions.disableSSR) {
            let app = <RouterContext {...this.renderProps} {...this.serverOptions.props} />;

            if (typeof this.clientOptions.wrapperHook === 'function') {
              app = this.clientOptions.wrapperHook(app);
            }

            if (
              this.serverOptions.dehydrateHook &&
              typeof this.serverOptions.dehydrateHook === 'function'
            ) {
              dehydrate = this.serverOptions.dehydrateHook();
            }

            renderToStringWithData(app)
              .then(content => {
                resolve({ html: content, frData, dehydrate });
              })
              .catch(error => reject(error));
          }
        } catch (ex) {
          console.error(`Error when doing SSR. path:${this.req.url}: ${ex.message}`);
          console.error(ex.stack);
          reject(ex);
        }
      });
    });

    // if (this.serverOptions.shouldCache) {
    //   setCachePage(this.req.url, { html, frData });
    // }
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
  return urls && Array.isArray(urls) && urls.some(url => reqUrl.pathname.startsWith(url));
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
  const url = req.url.pathname;

  if (
    url &&
    [
      '/favicon.ico',
      '/robots.txt',
      '/app.manifest',
      '/graphql',
      '/graphiql',
      '/service-worker.js',
    ].some(item => item === url)
  ) {
    return false;
  }

  // Avoid serving app HTML for declared routes such as /sockjs/.
  if (RoutePolicy.classify(url)) {
    return false;
  }
  return true;
}
