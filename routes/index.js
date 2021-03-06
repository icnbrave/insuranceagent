/*	
 * Copyright IBM Corp. 2016
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @author Steven Atkin
 */


var express = require('express');
var router = express.Router();
var passport = require('passport');
var optional = require('optional');
var appEnv = require('cfenv').getAppEnv();
var cfEnvUtil = require('./cfenv-credsbylabel');
var OpenIDConnectStrategy = require('passport-idaas-openidconnect').IDaaSOIDCStrategy;
var expressSession = require('express-session');
var redis = require('redis');
var RedisStore = require('connect-redis')(expressSession);


var serviceSSORegex = /(SingleSignOn).*/;
var serviceRedisRegex = /(compose-for-redis).*/;

var optionsSSO = optional('./sso-credentials.json') || {
  appEnv: appEnv
};

var optionsRedis = optional('./redis-credentials.json') || {
  appEnv: appEnv
};

// parse vcap using cfenv if available
if (optionsSSO.appEnv && !optionsSSO.credentials) {
  optionsSSO.credentials = cfEnvUtil.getServiceCredsByLabel(optionsSSO.appEnv, serviceSSORegex);
}
// try again with name
else if (optionsSSO.appEnv && !optionsSSO.credentials) {
  optionsSSO.credentials = optionsSSO.appEnv.getServiceCreds(serviceSSORegex);
}

// parse vcap using cfenv if available
if (optionsRedis.appEnv && !optionsRedis.credentials) {
  optionsRedis.credentials = cfEnvUtil.getServiceCredsByLabel(optionsRedis.appEnv, serviceRedisRegex);
}
// try again with name
else if (optionsRedis.appEnv && !optionsRedis.credentials) {
  optionsRedis.credentials = optionsRedis.appEnv.getServiceCreds(serviceRedisRegex);
}

var client_id = optionsSSO.credentials.clientId;
var client_secret = optionsSSO.credentials.secret;
var authorization_url = optionsSSO.credentials.authorizationEndpointUrl;
var token_url = optionsSSO.credentials.tokenEndpointUrl;
var issuer_id = optionsSSO.credentials.issuerIdentifier;
var redis_url = optionsRedis.credentials.uri;

var redisClient = redis.createClient(redis_url);

redisClient.on('error', function (err) {
    console.log('Error ' + err);
});

redisClient.on('connect', function() {
    console.log('Connected to Redis');
});

router.use(expressSession({
  secret: process.env.SESSION_SECRET,
  resave: 'true',
  saveUninitialized: 'true',
  store: new RedisStore({ client: redisClient })
}))

router.use(passport.initialize());
router.use(passport.session());

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});


// you MUST change the host route to match your application name
var callback_url = process.env.CALLBACK_URL;

var OpenIDConnectStrategy = require('passport-idaas-openidconnect').IDaaSOIDCStrategy;
var Strategy = new OpenIDConnectStrategy({
    authorizationURL: authorization_url,
    tokenURL: token_url,
    clientID: client_id,
    scope: 'openid',
    response_type: 'code',
    clientSecret: client_secret,
    callbackURL: callback_url,
    skipUserProfile: true,
    issuer: issuer_id
  },
  function (accessToken, refreshToken, profile, done) {
    process.nextTick(function () {
      profile.accessToken = accessToken;
      profile.refreshToken = refreshToken;
      done(null, profile);
    })
  });

passport.use(Strategy);

function ensureAuthenticated(req, res, next) {
  if (!req.isAuthenticated() && process.env.NODE_ENV == 'production') {
    req.session.originalUrl = req.originalUrl;
    res.redirect('/login');
  } else {
    return next();
  }
}

router.get('/login', passport.authenticate('openidconnect', {}));

router.get('/failure', function (req, res) {
  res.send('login failed');
});


router.get('/auth/sso/callback', function (req, res, next) {
  var redirect_url = req.session.originalUrl;
  passport.authenticate('openidconnect', {
    successRedirect: redirect_url,
    failureRedirect: '/failure',
  })(req, res, next);
});

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res, next) {
  res.render('index');
});


module.exports = router;