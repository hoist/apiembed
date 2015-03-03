'use strict';

var compression = require('compression');
var debug       = require('debug')('apiembed');
var express     = require('express');
var httpsnippet = require('httpsnippet');
var morgan      = require('morgan');
var unirest     = require('unirest');
var util        = require('util');

var availableTargets = httpsnippet._targets().map(function (target) {
  return httpsnippet.info(target);
});

var APIError = function  (code, message) {
  this.name = 'APIError';
  this.code = (code || 500);
  this.message = (message || 'Oops, something went wrong!');
};

APIError.prototype = Error.prototype;

// load .env
require('dotenv').load();

// express setup
var app = express();
app.set('view engine', 'jade');
app.disable('x-powered-by');

if (!process.env.NOCACHE) {
  app.enable('view cache');
}

// logging
app.use(morgan('dev'));

// add 3rd party middlewares
app.use(compression());

// useful to get info in the view
app.locals.httpsnippet = httpsnippet;

// enable CORS
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// static middleware does not work here
app.use('/favicon.ico', function (req, res) {
  res.sendFile(__dirname + '/static/favicon.ico');
});

// static middleware does not work here
app.use('/targets', function (req, res) {
  res.json(availableTargets);
});

app.get('/:source?/:targets?', function (req, res, next) {
  var source = decodeURIComponent(req.params.source || req.query.source);
  var targets = req.params.targets || req.query.target;

  if (!targets) {
    targets = 'all';
  }

  if (!source) {
    return next(new APIError(400, 'Invalid input'));
  }

  debug('recieved request for source: %s & targets: %s', source, targets);

  // force formatting
  if (!util.isArray(targets)) {
    targets = new Array(targets);
  }

  // overwrite targets if "all" is chosen
  if (~targets.indexOf('all')) {
    targets = [];

    availableTargets.map(function (target) {
      if (!target.members) {
        return targets.push(target.key);
      }


      target.members.map(function (member) {
        targets.push(target.family + '-' + member.key);
      });
    });
  }

  // construct family-target pair
  var conversionTargets = targets.map(function (target) {
    var result = target.split('-');

    if (result.length > 1) {
      return {
        family: result[0],
        key: result[1]
      };
    }

    return {
      family: result[0]
    };
  });


  unirest.get(source)
    .headers({'Accept': 'application/json'})
    .end(function (response) {
      if (response.error) {
        debug('failed to load source over http: %s %s', response.code || response.error.code , response.status || response.error.message);

        return next(new APIError(400, 'Could not load JSON source'));
      }

      var snippet;
      var output = {};

      if (typeof response.body !== 'object') {
        try {
          response.body = JSON.parse(response.body);
        } catch (err) {
          debug('failed to parse content of %s, with error: %s', source, err.message);

          return next(new APIError(400, 'Invalid JSON source'));
        }
      }

      try {
        snippet = new httpsnippet(response.body);
      } catch (err) {
        debug('failed to generate snippet object: %s', err.message);

        return next(new APIError(400, err));
      }

      conversionTargets.map(function (target) {
        if (!target.key) {
          return output[target.family] = snippet.convert(target.family, target.key);
        }

        if (target.key && !output[target.family]) {
          output[target.family] = {};
        }

        return output[target.family][target.key] = snippet.convert(target.family, target.key);
      });

      if (Object.keys(output).length === 0) {
        debug('no matching targets found');

        return next(new APIError(400, 'Invalid Targets'));
      }

      res.render('main', {
        output: output
      });

      res.end();
    });
});

// error handler
app.use(function errorHandler(error, req, res, next) {
  if (error.code === 400) {
    error.message += ', please review the <a href="/" target="_top">documentation</a> and try again';
  }

  res.status(error.code);
  res.render('error', error);
});

app.listen(process.env.PORT || process.env.npm_package_config_port);