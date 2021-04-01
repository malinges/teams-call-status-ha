import * as fs from 'fs';
import * as mqtt from 'mqtt';
import * as os from 'os';
import * as path from 'path';
import { Observable, timer } from 'rxjs';
import { distinctUntilChanged, first, map, repeat, switchMap, tap, throttleTime } from 'rxjs/operators';

const LOG_FILE = path.resolve(os.homedir(), 'Library/Application Support/Microsoft/Teams/logs.txt');

const BASE_TOPIC = `simon_in_teams_call`;
const AVAILABILITY_TOPIC = `${BASE_TOPIC}/status`;
const STATE_TOPIC = `${BASE_TOPIC}/state`;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
};

const MQTT_BROKER = env('MQTT_BROKER');
const MQTT_CLIENT_ID = env('MQTT_CLIENT_ID');
const MQTT_USERNAME = env('MQTT_USERNAME');
const MQTT_PASSWORD = env('MQTT_PASSWORD');

enum Availability {
  AVAILABLE = 'online',
  UNAVAILABLE = 'offline',
}

enum BinarySensorValue {
  ON = 'ON',
  OFF = 'OFF',
}

const watch = (filename: fs.PathLike) =>
  timer(0, 1000).pipe(
    first(() => {
      try {
        return fs.statSync(filename).isFile();
      } catch (err) {
        if (err?.code === 'ENOENT') return false;
        throw err;
      }
    }),
    switchMap(
      () =>
        new Observable<void>((observer) => {
          observer.next();

          const watcher = fs.watch(filename);
          watcher.on('change', (eventType) => {
            if (eventType === 'change') {
              observer.next();
            } else {
              watcher.close();
            }
          });
          watcher.on('error', (err) => observer.error(err));
          watcher.on('close', () => observer.complete());

          return () => watcher.close();
        }),
    ),
    repeat(),
  );

const getLastCallStatus = (filename: fs.PathLike): boolean =>
  fs
    .readFileSync(filename, { encoding: 'utf8' })
    .split(/(?:\r\n|\r|\n)/)
    .filter((line) => line.match(/eventData: s::;m::1;a::[13]/))
    .pop()
    ?.match(/eventData: s::;m::1;a::1/) != null;

const watchCallStatus = (filename: fs.PathLike): Observable<boolean> =>
  watch(filename).pipe(
    throttleTime(1000),
    map(() => getLastCallStatus(filename)),
    distinctUntilChanged(),
  );

const mqttClient$ = new Observable<mqtt.MqttClient>((observer) => {
  const client = mqtt.connect(`mqtt://${MQTT_BROKER}`, {
    clientId: MQTT_CLIENT_ID,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    will: {
      topic: AVAILABILITY_TOPIC,
      payload: Availability.UNAVAILABLE,
      qos: 1,
      retain: true,
    },
  });

  client.on('connect', () => {
    console.log('MQTT connected!');
    client.publish(AVAILABILITY_TOPIC, Availability.AVAILABLE, {
      qos: 1,
      retain: true,
    });
  });

  client.on('error', (error) => console.error('MQTT error:', error));

  observer.next(client);

  return () => client.end();
});

const main$ = mqttClient$.pipe(
  switchMap((client) =>
    watchCallStatus(LOG_FILE).pipe(
      tap((inCall) => {
        console.log(`in call: ${inCall}`);
        client.publish(STATE_TOPIC, inCall ? BinarySensorValue.ON : BinarySensorValue.OFF, {
          qos: 1,
          retain: true,
        });
      }),
    ),
  ),
);

main$.subscribe();
