'use strict'

var compression = require('compression')
var debug = require('debug')('apiembed')
var express = require('express')
var HTTPSnippet = require('httpsnippet')
var morgan = require('morgan')
var unirest = require('unirest')

module.exports = function (callback) {

  var APIError = function (code, message) {
    this.name = 'APIError'
    this.code = code || 500
    this.message = message || 'Oops, something went wrong!'
  }

  APIError.prototype = Error.prototype

  // express setup
  var app = express()
  app.set('view engine', 'jade')
  app.disable('x-powered-by')

  if (!process.env.NOCACHE) {
    app.enable('view cache')
  }

  // logging
  app.use(morgan('dev'))

  // add 3rd party middlewares
  app.use(compression())

  // enable CORS
  app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
  })

  // static middleware does not work here
  app.use('/favicon.ico', function (req, res) {
    res.sendFile(__dirname + '/static/favicon.ico')
  })

  app.get('/', function (req, res, next) {
    var source = decodeURIComponent(req.query.source)

    if (!source) {
      return next(new APIError(400, 'Invalid input'))
    }

    debug('received request for source: %s', source)

    unirest.get('https://api.github.com/gists/' + source)
      .headers({
        'User-Agent': 'gistembed',
        'Accept': 'application/json'
      })
      .end(function(response) {
        
        var body = response.body;
        var output = {};
        for(var key in body.files) {
          if(body.files.hasOwnProperty(key)) {
            output[key] = {
              src: body.files[key].content,
              safe: key.replace('.', '')
            };
          }
        }

        res.render('main', {
          output: output
        })
        res.end();
    })

  })

  // error handler
  app.use(function errorHandler (error, req, res, next) {
    if (error.code === 400) {
      error.message += ', please review the <a href="https://apiembed.com/#docs" target="_blank">documentation</a> and try again'
    }

    // never show a 40x
    res.status(200)
    res.render('error', error)
  })
    
  app.listen(process.env.PORT || process.env.npm_package_config_port)

  if (typeof callback === 'function') {
    callback()
  }
}
