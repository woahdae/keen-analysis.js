import 'promise-polyfill/src/polyfill';
import 'whatwg-fetch';

import each from 'keen-core/lib/utils/each';
import extend from 'keen-core/lib/utils/extend';
import serialize from 'keen-core/lib/utils/serialize';

import { getFromCache, saveToCache } from './cache-browser';

const sendFetch = (method, config, options = {}) => {
  const headers = {};
  let url = config.url;

  if (method === 'GET' || method === 'DELETE') {
    if(url.indexOf('?') === -1){
      url += '?';
    } else {
      url += '&';
    }
    if (config.api_key) {
      url += 'api_key=' + config.api_key + '&';
    }
    if (config.params) {
      url += serialize(config.params);
    }
  }

  each(config.headers, function(value, key){
    if (typeof value === 'string') {
      headers[key] = value;
    }
  });

  const fetchOptions = {
    method,
    body: (method !== 'GET' && config.params) ?
      JSON.stringify(config.params) : undefined,
    mode: 'cors',
    headers
  };

  if (config.cache
    && method !== 'DELETE'
    && method !== 'PUT'
    && !options.notFoundInCache
  ) {
    return getFromCache(url, fetchOptions, config)
      .then(responseJSONFromCache => {
        if (responseJSONFromCache) {
          return options.resolve(responseJSONFromCache);
        }
        sendFetch(method, config, {...options, notFoundInCache: true});
      });
  }

  let apiResponse;

  fetch(url, {
      ...fetchOptions,
      signal: options.signal // abort signal
    })
    .catch(connectionError => {
      options.reject(connectionError);
      return;
    })
    .then(response => {
      if (!response) return;
      apiResponse = response;
      if (response.ok && method === 'DELETE'){
        return {};
      }
      return response.json();
     })
    .then(responseJSON => {
      if (!responseJSON) return;
      if (responseJSON.error_code || !apiResponse.ok) {
        return options.reject({
          ok: false,
          error_code: responseJSON.error_code,
          body: responseJSON.message,
          status: apiResponse.status,
          statusText: apiResponse.statusText
        });
      }
      if (config.cache
        && method !== 'DELETE'
        && method !== 'PUT'
      ) {
        saveToCache(url, fetchOptions, responseJSON);
      }
      const httpOptions = extend({}, config);

      if(Array.isArray(responseJSON.result)){
        if(config.params.interval){
          if(config.params.group_by){
            if(config.params.analysis_type === 'extraction'){
              options.resolve(responseJSON);
            } else if (responseJSON.result && Array.isArray(responseJSON.result)){
              //interval and group by result
              responseJSON.result.forEach((val) => {
                if (!val.value) return val;
                if (!Array.isArray(val.value)) return val.value;
                val.value.forEach((res) => {
                  if(!isNaN(Number(res.result))){
                    res.result = Number(res.result);
                  }
                })
              })
            }
          }
          else {
            //interval result
            responseJSON.result.forEach((val) => {
              if(!isNaN(Number(val.value))){
                val.value = Number(val.value);
              }
            })
          }
        }
        else {
          //group by result
          responseJSON.result.forEach((res) => {
            if(!isNaN(Number(res.result))){
              res.result = Number(res.result);
            }
          })
        }
      }
      else {
        //simple result
        if(!isNaN(Number(responseJSON.result))){
          responseJSON.result = Number(responseJSON.result);
        }
      }
      //math round values config check
      if(config.resultParsers){
        if(Array.isArray(responseJSON.result)){
            if(config.params.interval){
              if(config.params.group_by){
                //interval and group by result
                responseJSON.result.forEach((val) => {
                  val.value.forEach((res) => {
                    let parsedValue;
                    config.resultParsers.forEach((func) => {
                      parsedValue = parsedValue ? func(parsedValue) : func(res.result);
                    })
                    res.result = parsedValue;
                  })
                })
              }
              else {
                //interval result
                responseJSON.result.forEach((val) => {
                  let parsedValue;
                  config.resultParsers.forEach((func) => {
                    parsedValue = parsedValue ? func(parsedValue) : func(val.value);
                  })
                  val.value = parsedValue;
                })
              }
            }
            else {
              //group by result
              responseJSON.result.forEach((res) => {
                let parsedValue;
                config.resultParsers.forEach((func) => {
                  parsedValue = parsedValue ? func(parsedValue) : func(res.result);
                })
                res.result = parsedValue;
              })
            }
        } else if (typeof responseJSON.result === 'object') {
          Object.keys(responseJSON.result).forEach((res) => {
            let parsedValue;
            config.resultParsers.forEach((func) => {
              parsedValue = parsedValue ? func(parsedValue) : func(responseJSON.result[res]);
            });
            responseJSON.result[res] = parsedValue;
          });
        } else {
          //simple result
          let parsedValue;
          config.resultParsers.forEach((func) => {
            parsedValue = parsedValue ? func(parsedValue) : func(responseJSON.result);
          });
          responseJSON.result = parsedValue;
        }
      }
      if (httpOptions.params &&
        typeof httpOptions.params.event_collection !== 'undefined'
        && typeof responseJSON.query === 'undefined') {
          const responseWithQuery = extend({ query: httpOptions.params }, responseJSON);
          options.resolve(responseWithQuery);
      }

      options.resolve(responseJSON);
     });
}

// XMLHttpRequest Support
// ------------------------------
// DEPRECATED - WILL BE REMOVED
const xhrObject = () => {
  const root = window || this;
  if (root.XMLHttpRequest &&
       (
         !root.ActiveXObject ||
         (root.location && root.location.protocol
           && 'file:' !== root.location.protocol)
       )
  ) {
    return new XMLHttpRequest;
  } else {
    try { return new ActiveXObject('Microsoft.XMLHTTP'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP.6.0'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP.3.0'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP'); } catch(e) {}
  }
  return false;
}

const sendXhr = (method, config, options = {}) => {
  const xhr = xhrObject();
  const cb = options.callback;
  let url = config.url;

  xhr.onreadystatechange = function() {
    let response;
    if (xhr.readyState == 4) {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.status === 204) {
          if (cb) {
            cb(null, xhr);
          }
        }
        else {
          try {
            response = JSON.parse( xhr.responseText );
            if (cb && response) {
              cb(null, response);
            }
          }
          catch (e) {
            if (cb) {
              cb(xhr, null);
            }
          }
        }
      }
      else {
        try {
          response = JSON.parse( xhr.responseText );
          if (cb && response) {
            cb(response, null);
          }
        }
        catch (e) {
          if (cb) {
            cb(xhr, null);
          }
        }
      }
    }
  };

  if (method !== 'GET') {
    xhr.open(method, url, true);
    each(config.headers, function(value, key){
      if (typeof value === 'string') {
        xhr.setRequestHeader(key, value);
      }
    });
    if (config.params) {
      xhr.send( JSON.stringify(config.params) );
    }
    else {
      xhr.send();
    }
  }
  else {
    url += '?';
    if (config.api_key) {
      url += 'api_key=' + config.api_key + '&';
    }
    if (config.params) {
      url += serialize(config.params);
    }
    xhr.open(method, url, true);
    each(config.headers, function(value, key){
      if (typeof value === 'string') {
        xhr.setRequestHeader(key, value);
      }
    });
    xhr.send();
  }

  return xhr;
}

// JSON-P Support
// DEPRECATED - WILL BE REMOVED
const sendJsonp = (config, options = {}) => {
  let url = config.url;
  let cb = options.callback;
  const timestamp = new Date().getTime();
  const scriptTag = document.createElement('script');
  const parent = document.getElementsByTagName('head')[0];
  let callbackName = 'keenJSONPCallback';
  let loaded = false;

  callbackName += timestamp;
  while (callbackName in window) {
    callbackName += 'a';
  }

  window[callbackName] = function(response) {
    if (loaded === true) {
      return;
    }
    handleResponse(null, response);
  };

  if (config.params) {
    url += serialize(config.params);
  }

  // Early IE (no onerror event)
  scriptTag.onreadystatechange = function() {
    if (loaded === false && this.readyState === 'loaded') {
      handleResponse('An error occurred', null);
    }
  };

  // Not IE
  scriptTag.onerror = function() {
    // on IE9 both onerror and onreadystatechange are called
    if (loaded === false) {
      handleResponse('An error occurred', null);
    }
  };

  scriptTag.src = url + '&jsonp=' + callbackName;
  parent.appendChild(scriptTag);

  const handleResponse = (a, b) => {
    loaded = true;
    if (cb && typeof cb === 'function') {
      cb(a, b);
      cb = void 0;
    }
    window[callbackName] = undefined;
    try {
      delete window[callbackName];
    } catch(e){};
    parent.removeChild(scriptTag);
  }

}

// HTTP Handlers
// ------------------------------

export const GET = (config, options) => {
  if (typeof fetch !== 'undefined') {
    return sendFetch('GET', config, options);
  }
  else if (xhrObject()) {
    return sendXhr('GET', config, options);
  }
  else {
    return sendJsonp(config, options);
  }
}

export const POST = (config, options) => {
  if (typeof fetch !== 'undefined') {
    return sendFetch('POST', config, options);
  }
  else if (xhrObject()) {
    return sendXhr('POST', config, options);
  }
  else {
    options.reject('XHR POST not supported');
  }
}

export const PUT = (config, options) => {
  if (typeof fetch !== 'undefined') {
    return sendFetch('PUT', config, options);
  }
  else if (xhrObject()) {
    return sendXhr('PUT', config, options);
  }
  else {
    options.reject('XHR PUT not supported');
  }
}

export const DEL = (config, options) => {
  if (typeof fetch !== 'undefined') {
    return sendFetch('DELETE', config, options);
  }
  else if (xhrObject()) {
    return sendXhr('DELETE', config, options);
  }
  else {
    options.reject('XHR DELETE not supported');
  }
}
