import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMp4SyncSamples, analyseSyncSampleIntervals } from '../mp4-parser.js';

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
