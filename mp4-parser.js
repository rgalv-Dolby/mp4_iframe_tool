function readU32(buffer, offset) {
  if (offset + 4 > buffer.length) {
    throw new Error(`Out-of-range read at offset ${offset}`);
  }
  return (buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3];
}

function readU64(buffer, offset) {
  if (offset + 8 > buffer.length) {
    throw new Error(`Out-of-range 64-bit read at offset ${offset}`);
  }
  const high = readU32(buffer, offset);
  const low = readU32(buffer, offset + 4);
  return (BigInt(high) << 32n) + BigInt(low);
}

function toText(value) {
  return Array.from(value)
    .map((byte) => String.fromCharCode(byte))
    .join('');
}

function parseStssBox(payload) {
  if (payload.length < 8) {
    return [];
  }

  const hasFullBoxHeader = payload[0] === 0 && payload[1] === 0 && payload[2] === 0 && payload[3] === 0;
  const entryCountOffset = hasFullBoxHeader ? 4 : 0;
  const dataOffset = entryCountOffset + 4;

  if (dataOffset + 4 > payload.length) {
    return [];
  }

  const entryCount = readU32(payload, entryCountOffset);
  const samples = [];

  for (let i = 0; i < entryCount; i += 1) {
    const samplePosition = dataOffset + i * 4;
    if (samplePosition + 4 > payload.length) {
      break;
    }
    samples.push(readU32(payload, samplePosition));
  }

  return samples;
}

function parseMdhdTimescale(payload) {
  if (payload.length < 16) {
    return null;
  }

  const version = payload[0];
  const timescaleOffset = version === 1 ? 20 : 12;
  if (timescaleOffset + 4 > payload.length) {
    return null;
  }

  return readU32(payload, timescaleOffset);
}

function parseHdlrType(payload) {
  if (payload.length < 12) {
    return null;
  }

  return toText(payload.subarray(8, 12));
}

function parseSttsTiming(payload) {
  if (payload.length < 8) {
    return null;
  }

  const entryCount = readU32(payload, 4);
  let sampleCount = 0;
  let duration = 0;

  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = 8 + i * 8;
    if (entryOffset + 8 > payload.length) {
      break;
    }
    sampleCount += readU32(payload, entryOffset);
    duration += readU32(payload, entryOffset + 4) * readU32(payload, entryOffset);
  }

  return { sampleCount, duration };
}

function walkBoxes(buffer, startOffset, endLimit, onBox, ancestors = []) {
  let offset = startOffset;

  while (offset + 8 <= endLimit) {
    const size = readU32(buffer, offset);
    const type = toText(buffer.subarray(offset + 4, offset + 8));

    if (size === 0) {
      break;
    }

    let boxSize = size;
    let payloadOffset = offset + 8;

    if (size === 1) {
      if (offset + 16 > endLimit) {
        break;
      }
      boxSize = Number(readU64(buffer, offset + 8));
      payloadOffset = offset + 16;
    }

    const boxEnd = offset + boxSize;
    if (boxEnd > endLimit) {
      break;
    }

    const payload = buffer.subarray(payloadOffset, boxEnd);
    onBox({ type, payload, offset, size: boxSize, end: boxEnd }, ancestors);

    const containerTypes = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'meta', 'udta', 'mvhd', 'tkhd', 'mdhd', 'hdlr', 'stsd', 'stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64', 'trak']);
    if (containerTypes.has(type)) {
      walkBoxes(buffer, payloadOffset, boxEnd, onBox, [...ancestors, { type, offset }]);
    }

    offset = boxEnd;
  }
}

export function parseMp4SyncSamples(fileData) {
  const bytes = fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : new Uint8Array(fileData);
  const syncSamples = [];

  walkBoxes(bytes, 0, bytes.length, (box) => {
    if (box.type === 'stss') {
      const parsed = parseStssBox(box.payload);
      if (parsed.length > 0) {
        syncSamples.push(...parsed);
      }
    }
  });

  return syncSamples;
}

export function parseMp4VideoFrameRate(fileData) {
  const bytes = fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : new Uint8Array(fileData);
  const tracks = new Map();

  walkBoxes(bytes, 0, bytes.length, (box, ancestors) => {
    const trackIndex = ancestors.findLastIndex((ancestor) => ancestor.type === 'trak');
    if (trackIndex === -1) {
      return;
    }

    const trackKey = ancestors[trackIndex].offset;
    const track = tracks.get(trackKey) ?? {};
    if (box.type === 'hdlr') {
      track.handlerType = parseHdlrType(box.payload);
    } else if (box.type === 'mdhd') {
      track.timescale = parseMdhdTimescale(box.payload);
    } else if (box.type === 'stts') {
      track.timing = parseSttsTiming(box.payload);
    }
    tracks.set(trackKey, track);
  });

  for (const track of tracks.values()) {
    if (track.handlerType !== 'vide' || !track.timescale || !track.timing || track.timing.duration === 0) {
      continue;
    }

    return track.timing.sampleCount * track.timescale / track.timing.duration;
  }

  return null;
}

export function analyseSyncSampleIntervals(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      samples: [],
      intervals: [],
      interval: null,
      isConstant: true,
      raw: 'No sync samples found',
    };
  }

  const sortedSamples = [...samples].sort((a, b) => a - b);
  const intervals = [];

  for (let i = 1; i < sortedSamples.length; i += 1) {
    intervals.push(sortedSamples[i] - sortedSamples[i - 1]);
  }

  const interval = intervals.length > 0 ? intervals[0] : null;
  const isConstant = intervals.every((value) => value === interval);

  return {
    samples: sortedSamples,
    intervals,
    interval,
    isConstant,
    raw: isConstant && interval !== null
      ? `Constant i-frame interval of ${interval} samples`
      : intervals.length > 0
        ? `Variable i-frame interval detected (${intervals.join(', ')})`
        : 'No interval data',
  };
}

export function parseAndAnalyseMp4(fileData) {
  const samples = parseMp4SyncSamples(fileData);
  return {
    ...analyseSyncSampleIntervals(samples),
    frameRate: parseMp4VideoFrameRate(fileData),
  };
}

export function matchSyncSamplesToAc4(samples, videoFrameRate, options = {}) {
  const sampleRate = options.sampleRate ?? 48000;
  const ac4FrameSize = options.ac4FrameSize ?? 2048;
  const ac4FrameDuration = ac4FrameSize / sampleRate;

  if (!Number.isFinite(videoFrameRate) || videoFrameRate <= 0) {
    throw new Error('A positive video frame rate is required for AC-4 alignment');
  }

  if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isFinite(ac4FrameSize) || ac4FrameSize <= 0) {
    throw new Error('AC-4 sample rate and frame size must be positive numbers');
  }

  return [...new Set(samples)]
    .filter((sample) => Number.isInteger(sample) && sample > 0)
    .sort((a, b) => a - b)
    .map((videoSample) => {
      const videoTime = (videoSample - 1) / videoFrameRate;
      const ac4Frame = Math.round(videoTime / ac4FrameDuration);
      const ac4Time = ac4Frame * ac4FrameDuration;

      return {
        videoSample,
        videoTime,
        ac4Frame,
        ac4Sample: ac4Frame * ac4FrameSize,
        ac4Time,
        deltaSeconds: ac4Time - videoTime,
        deltaSamples: Math.round((ac4Time - videoTime) * sampleRate),
        isExact: Math.abs(ac4Time - videoTime) < 1e-9,
      };
    });
}
