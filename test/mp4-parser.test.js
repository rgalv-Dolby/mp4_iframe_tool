import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseMp4SyncSamples,
  parseMp4VideoFrameRate,
  parseAndAnalyseMp4,
  analyseSyncSampleIntervals,
  matchSyncSamplesToAc4,
} from '../mp4-parser.js';

function makeUint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function buildBox(type, payload) {
  const size = 8 + payload.length;
  const box = Buffer.alloc(size);
  box.writeUInt32BE(size, 0);
  box.write(type, 4, 4, 'ascii');
  payload.copy(box, 8);
  return box;
}

function buildStssBox(entries) {
  const payload = Buffer.alloc(8 + entries.length * 4);
  payload.writeUInt32BE(0, 0);
  payload.writeUInt32BE(entries.length, 4);
  entries.forEach((entry, index) => payload.writeUInt32BE(entry, 8 + index * 4));
  return buildBox('stss', payload);
}

function buildVideoTrackWithTiming(entries, timescale, sampleDelta) {
  const stssBox = buildStssBox(entries);
  const sttsPayload = Buffer.alloc(16);
  sttsPayload.writeUInt32BE(0, 0);
  sttsPayload.writeUInt32BE(1, 4);
  sttsPayload.writeUInt32BE(240, 8);
  sttsPayload.writeUInt32BE(sampleDelta, 12);

  const mdhdPayload = Buffer.alloc(20);
  mdhdPayload.writeUInt32BE(0, 0);
  mdhdPayload.writeUInt32BE(0, 4);
  mdhdPayload.writeUInt32BE(0, 8);
  mdhdPayload.writeUInt32BE(timescale, 12);
  mdhdPayload.writeUInt32BE(240 * sampleDelta, 16);

  const hdlrPayload = Buffer.alloc(12);
  hdlrPayload.writeUInt32BE(0, 0);
  hdlrPayload.write('vide', 8, 4, 'ascii');

  const stbl = buildBox('stbl', Buffer.concat([stssBox, buildBox('stts', sttsPayload)]));
  const minf = buildBox('minf', stbl);
  const mdia = buildBox('mdia', Buffer.concat([
    buildBox('hdlr', hdlrPayload),
    buildBox('mdhd', mdhdPayload),
    minf,
  ]));
  const trak = buildBox('trak', mdia);
  const moov = buildBox('moov', trak);
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write('ftyp', 4, 4, 'ascii');
  ftyp.write('isom', 8, 4, 'ascii');

  return Buffer.concat([ftyp, moov]);
}

function buildVideoTrackWithStss(entries) {
  const stssBox = buildStssBox(entries);
  const stbl = buildBox('stbl', stssBox);
  const minf = buildBox('minf', stbl);
  const mdia = buildBox('mdia', minf);
  const trak = buildBox('trak', mdia);
  const moov = buildBox('moov', trak);
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write('ftyp', 4, 4, 'ascii');
  ftyp.write('isom', 8, 4, 'ascii');

  return Buffer.concat([ftyp, moov]);
}

test('extracts sync samples from an MP4 stss box', () => {
  const file = buildVideoTrackWithStss([10, 21, 32, 43]);
  const samples = parseMp4SyncSamples(file);

  assert.deepEqual(samples, [10, 21, 32, 43]);
});

test('reads the video frame rate from mdhd and stts timing', () => {
  const file = buildVideoTrackWithTiming([1, 25], 48000, 2048);

  assert.equal(parseMp4VideoFrameRate(file), 23.4375);
  assert.equal(parseAndAnalyseMp4(file).frameRate, 23.4375);
});

test('keeps the video timing when the MP4 also contains an audio track', () => {
  const file = readFileSync(new URL('./The_Artist-1.mp4', import.meta.url));

  assert.equal(parseMp4VideoFrameRate(file), 30);
});

test('detects constant I-frame intervals', () => {
  const result = analyseSyncSampleIntervals([10, 21, 32, 43]);

  assert.equal(result.isConstant, true);
  assert.deepEqual(result.intervals, [11, 11, 11]);
  assert.equal(result.interval, 11);
});

test('detects non-constant I-frame intervals', () => {
  const result = analyseSyncSampleIntervals([10, 21, 32, 46]);

  assert.equal(result.isConstant, false);
  assert.deepEqual(result.intervals, [11, 11, 14]);
});

test('matches video sync samples to the native AC-4 frame cadence', () => {
  const result = matchSyncSamplesToAc4([1, 25, 49], 23.4375);

  assert.deepEqual(result.map((match) => match.ac4Frame), [0, 24, 48]);
  assert.equal(result[0].isExact, true);
  assert.equal(result[1].deltaSamples, 0);
  assert.equal(result[2].deltaSamples, 0);
});

test('reports the nearest AC-4 boundary when a video sync sample is not exact', () => {
  const [match] = matchSyncSamplesToAc4([2], 24);

  assert.equal(match.ac4Frame, 1);
  assert.equal(match.isExact, false);
  assert.equal(match.deltaSamples, 48);
});
