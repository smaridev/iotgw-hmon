#!/usr/bin/env node

const os = require('os');
const MQTT = require('mqtt');

const LOGGING_LEVELS = {
  FATAL: 0,
  ERROR: 1,
  DEBUG: 3,
  INFO: 2
};

let Thingy = null;

const APP_STATE_RUNNING = 'running';
const APP_STATE_STOPPING = 'stopping';
const SEND_GATEWAY_CONNECTED = 'GATEWAY_CONNECTED';
const SEND_DEVICE_CONNECTED = 'DEVICE_CONNECTED';

const DISCOVER_RESTART_TIMEOUT = 1000; // XXX: Workaround for noble-device issue
const APPLICATION_START_TIMEOUT = 5 * 1000; 

let dataTransmissionTaskId = null;

let applicationState = APP_STATE_RUNNING;

let mqttClient = null;
let connectedThingy = null;
const thingyState = {
  accel: {
    x: 0,
    y: 0,
    z: 0
  },
  button: false
};
let config = {};

// Commons
// ==========

const loadConfig = () => {
  const c = require('./config');
  let { topic } = c.mqtt;
  //topic = topic.replace('{hostname}', os.hostname());
  c.mqtt.topic = topic;
  return c;
};

const log = (msg, data = '', level = LOGGING_LEVELS.DEBUG) => {
  const appLoggingLevel = LOGGING_LEVELS[config.app.loggingLevel];
  if (level <= LOGGING_LEVELS.ERROR) {
    console.error(msg, data);
  }
  else if (level <= appLoggingLevel) {
    console.log(`${msg}`, data);
  }
};

// Broker Utils
// ==========

const brokerDisconnect = () => {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }
};

const brokerConnect = (mqttConfig) => {
  const mqttAddr = `${mqttConfig.host}:${mqttConfig.port}`;
  log(`Connecting to: ${mqttAddr}`);

  const connectionProblemsHandler = (err) => {
    if (err) {
      log('Connection problem, disconnecting ...', err, LOGGING_LEVELS.ERROR);
    }
  };
  log('new MQTT client creation ...');
  mqttClient = MQTT.connect({
    protocol: 'mqtt',
    host: mqttConfig.host,
    port: mqttConfig.port,
    reconnecting: true
  });

  mqttClient.on('connect', () => {
    log(`Successfully connected to: ${mqttAddr}`, '', LOGGING_LEVELS.INFO);
  });

  mqttClient.on('close', connectionProblemsHandler);
  mqttClient.on('error', connectionProblemsHandler);
  mqttClient.on('end', connectionProblemsHandler);
  mqttClient.on('offline', connectionProblemsHandler);
};

const macToId = mac => (mac.toLowerCase().replace(new RegExp(':', 'g'), ''));

const send = (topic, payload, status) => {
  const msg = JSON.stringify({
    status,
    timestamp: Math.round((new Date()).getTime() / 1000),
    payload
  });
  mqttClient.publish(topic, msg);
  log(`Publish to ${topic} ${msg}`);
};

function getserial() {

   var serial = null;
   var fs = require('fs');
   var content = fs.readFileSync('/proc/cpuinfo', 'utf8');
   var cont_array = content.split("\n");
   var serial_line = cont_array.filter(data => {
            return data.indexOf('Serial') === 0
   });

   if (serial_line.length > 0) {
      serial = serial_line[0].split(":")[1];
   }
   
   return serial;
}




const sendHealth = (appConfig) => {
  var os = require('os');
  var os = require('os-utils');

  os.cpuUsage(function(v){
      console.log( 'CPU Usage (%): ' + v );
      const msg = JSON.stringify({
      tpid: getserial(),
	  message: "iot-gw/healthmon/devicemon",
      timestamp: Math.round((new Date()).getTime() / 1000),
      cpu_usage: v,
      totalmem: os.totalmem(),
      freemem: os.freemem()
    });

    mqttClient.publish("healthmon/devicemon", msg);
    log(`Publish to devicemon ${msg}`);
  });

    
};

/*
  const msg = JSON.stringify({
    timestamp: Math.round((new Date()).getTime() / 1000),
    cpu_usage: os.cpuUsage(),    
    totalmem: os.totalmem(),
    freemem: os.freemem()     
  });

  mqttClient.publish("/healthmon/devicemon", msg);
  log(`Publish to devicemon ${msg}`);

};
*/

const sendDeviceState = (appConfig) => {
  var os = require('os');

  const msg = JSON.stringify({
    tpid: getserial(),
	message: "iot-gw/healthmon/deviceinfo",
    status: "online",
    timestamp: Math.round((new Date()).getTime() / 1000),
    networkdetails: os.networkInterfaces( ),
    hostname:  os.hostname()
  });

  mqttClient.publish("healthmon/deviceinfo", msg);
  log(`Publish to devicemon ${msg}`);

};

const startSendingTask = (appConfig) => {
  log('Start Sending Task ...');
  return setInterval(() => {
    if (mqttClient) {
        sendDeviceState(appConfig.mqtt);
        sendHealth(appConfig.mqtt);      
    }
  }, appConfig.app.sendInterval);
};

const stopSendingTask = () => {
  log('Stop Sending Task ...');
  clearInterval(dataTransmissionTaskId);
};

// App Utils
// ==========

const start = (appConfig) => {
  log('Starting with Config: ', appConfig, LOGGING_LEVELS.INFO);

  brokerConnect(appConfig.mqtt);
  dataTransmissionTaskId = startSendingTask(appConfig);
};

const stop = () => {
  if (applicationState === APP_STATE_STOPPING) return;
  applicationState = APP_STATE_STOPPING;
  log('Stopping ...');
  stopSendingTask();
  brokerDisconnect();
};

const init = () => {
  config = loadConfig();
  log('Initialize ...');
  // Set exit handlers
  process.on('exit', () => {
    stop();
  });
  process.on('uncaughtException', (err) => {
    log('uncaughtException:', err, LOGGING_LEVELS.FATAL);
    try {
      stop();
    }
    catch (stopErr) {
      log('Error while stop:', stopErr, LOGGING_LEVELS.FATAL);
    }
    finally {
      process.exit(-1);
    }
  });
  return config;
};

// Application
// ==========
init();
setTimeout(() => {
  start(config);
}, APPLICATION_START_TIMEOUT);

