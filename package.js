Package.describe({
  name: 'thelohoadmin:react-router-ssr',
  version: '3.2.5_3',
  summary:
    'Server-side rendering for react-router and react-meteor-data rehydratating Meteor subscriptions',
  git: 'https://github.com/simsim0709/meteor-react-router-ssr.git',
  documentation: 'README.md',
});

Npm.depends({
  'lru-cache': '4.0.2',
  // 'cookie-parser': '1.4.1',
});

Package.onUse(function(api) {
  api.versionsFrom('1.3');
  api.use([
    'ecmascript',
    'tracker',
    'minimongo@1.0.0',
    'staringatlights:fast-render@2.16.3',
    'staringatlights:inject-data@2.0.5',
    'tmeasday:check-npm-versions@0.2.0',
  ]);

  api.use(
    [
      'underscore@1.0.3',
      'webapp@1.2.0',
      'mongo@1.0.0',
      'routepolicy@1.0.5',
      'url@1.0.9',
    ],
    'server'
  );

  api.use(
    ['autopublish@1.0.0', 'tmeasday:publish-counts@0.7.0', 'promise@0.5.1'],
    'server',
    { weak: true }
  );

  api.export('ReactRouterSSR');
  api.mainModule('lib/client/react-router-ssr.js', 'client');
  api.mainModule('lib/server/react-router-ssr.js', 'server');
  api.add_files(['lib/server/cache.js'], 'server');
});
