(function () {
  'use strict';

  var voices = [
    { id: 'kick', name: 'Kick', short: 'BD', defaultVolume: 82, volume: 82, defaultPitch: 0, pitch: 0 },
    { id: 'snare', name: 'Snare', short: 'SD', defaultVolume: 72, volume: 72, defaultPitch: 0, pitch: 0 },
    { id: 'clap', name: 'Clap', short: 'CP', defaultVolume: 62, volume: 62 },
    { id: 'closedHat', name: 'Closed hat', short: 'CH', defaultVolume: 59, volume: 59 },
    { id: 'openHat', name: 'Open hat', short: 'OH', defaultVolume: 48, volume: 48 },
    { id: 'lowTom', name: 'Low tom', short: 'LT', defaultVolume: 68, volume: 68, defaultPitch: 0, pitch: 0 },
    { id: 'midTom', name: 'Mid tom', short: 'MT', defaultVolume: 64, volume: 64, defaultPitch: 0, pitch: 0 },
    { id: 'highTom', name: 'High tom', short: 'HT', defaultVolume: 62, volume: 62, defaultPitch: 0, pitch: 0 },
  ];
  var demoPattern = [
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
  var pattern = copyPattern(demoPattern);
  var tracks = document.getElementById('tracks');
  var mixer = document.getElementById('mixer');
  var playButton = document.getElementById('play');
  var tempo = document.getElementById('tempo');
  var tempoValue = document.getElementById('tempo-value');
  var statusText = document.getElementById('status-text');
  var visualizerState = document.getElementById('visualizer-state');
  var transport = document.querySelector('.transport');
  var canvas = document.getElementById('visualizer');
  var canvasContext = canvas.getContext('2d');
  var audioContext = null;
  var masterGain = null;
  var analyser = null;
  var noiseBuffer = null;
  var activeSources = [];
  var isPlaying = false;
  var nextStepTime = 0;
  var nextStep = 0;
  var playbackStart = 0;
  var timer = null;
  var animationFrame = null;
  var visualizerAnimationFrame = null;
  var dataArray = null;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function copyPattern(source) {
    return source.map(function (row) { return row.slice(); });
  }

  function renderTracks() {
    tracks.innerHTML = voices.map(function (voice, row) {
      var steps = pattern[row].map(function (active, index) {
        return '<button class="step' + (active ? ' on' : '') + '" type="button" data-row="' + row + '" data-step="' + index + '" aria-label="' +
          voice.name + ', step ' + (index + 1) + '" aria-pressed="' + (active ? 'true' : 'false') + '"></button>';
      }).join('');
      return '<div class="track" data-track="' + row + '">' +
        '<button class="voice-button" type="button" data-preview="' + row + '" aria-label="Preview ' + voice.name + '">' +
          '<span class="voice-mark">' + voice.short + '</span><span>' + voice.name + '</span>' +
        '</button>' +
        '<div class="steps" role="group" aria-label="' + voice.name + ' steps">' + steps + '</div>' +
      '</div>';
    }).join('');
  }

  function renderMixer() {
    mixer.innerHTML = voices.map(function (voice, index) {
      var pitchControl = voice.pitch === undefined
        ? '<div class="pitch-unavailable" aria-label="' + voice.name + ' has no pitch control">NO PITCH</div>'
        : '<label for="pitch-' + voice.id + '">Pitch<output id="pitch-value-' + voice.id + '">' + formatPitch(voice.pitch) + '</output></label>' +
          '<input id="pitch-' + voice.id + '" type="range" min="-12" max="12" step="1" value="' + voice.pitch + '" data-pitch="' + index + '" aria-label="' + voice.name + ' pitch in semitones">';
      return '<div class="mixer-channel">' +
        '<label for="level-' + voice.id + '">' + voice.name + '<output id="level-value-' + voice.id + '">' + voice.volume + '%</output></label>' +
        '<input id="level-' + voice.id + '" type="range" min="0" max="100" value="' + voice.volume + '" data-volume="' + index + '" aria-label="' + voice.name + ' volume">' +
        '<div class="pitch-control">' + pitchControl + '</div>' +
      '</div>';
    }).join('');
  }

  function formatPitch(semitones) {
    return (semitones > 0 ? '+' : '') + semitones + ' st';
  }

  function setStatus(message, error) {
    statusText.textContent = message;
    statusText.classList.toggle('error', Boolean(error));
  }

  function initAudio() {
    var AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error('Web Audio is not supported in this browser.');
    if (audioContext && audioContext.state === 'closed') audioContext = null;
    if (!audioContext) {
      audioContext = new AudioContextConstructor();
      masterGain = audioContext.createGain();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      noiseBuffer = createNoiseBuffer(audioContext);
      masterGain.gain.value = 0.8;
      masterGain.connect(analyser);
      analyser.connect(audioContext.destination);
    }
  }

  function createNoiseBuffer(context) {
    var length = context.sampleRate;
    var buffer = context.createBuffer(1, length, context.sampleRate);
    var channel = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) channel[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function trackSource(source) {
    activeSources.push(source);
    source.onended = function () {
      activeSources = activeSources.filter(function (active) { return active !== source; });
    };
  }

  function noiseSource(at, duration, type, frequency, level) {
    var source = audioContext.createBufferSource();
    var filter = audioContext.createBiquadFilter();
    var gain = audioContext.createGain();
    source.buffer = noiseBuffer;
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.8 * level, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    trackSource(source);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  function tone(at, startFrequency, endFrequency, duration, level, type, pitch) {
    var oscillator = audioContext.createOscillator();
    var gain = audioContext.createGain();
    var pitchRatio = Math.pow(2, pitch / 12);
    oscillator.type = type || 'sine';
    oscillator.frequency.setValueAtTime(startFrequency * pitchRatio, at);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency * pitchRatio, at + duration);
    oscillator.connect(gain);
    gain.connect(masterGain);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    trackSource(oscillator);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  function triggerVoice(index, at) {
    var voice = voices[index];
    var volume = voice.volume / 100;
    if (volume <= 0) return;
    switch (voice.id) {
      case 'kick':
        tone(at, 155, 42, 0.31, 1.0 * volume, 'sine', voice.pitch);
        break;
      case 'snare':
        noiseSource(at, 0.2, 'highpass', 1250, volume);
        tone(at, 185, 115, 0.14, 0.23 * volume, 'triangle', voice.pitch);
        break;
      case 'clap':
        noiseSource(at, 0.16, 'bandpass', 1450, volume);
        noiseSource(at + 0.014, 0.17, 'bandpass', 1700, volume);
        noiseSource(at + 0.032, 0.19, 'bandpass', 1900, volume);
        break;
      case 'closedHat':
        noiseSource(at, 0.055, 'highpass', 7600, volume);
        break;
      case 'openHat':
        noiseSource(at, 0.42, 'highpass', 6500, volume);
        break;
      case 'lowTom':
        tone(at, 145, 68, 0.28, 0.82 * volume, 'sine', voice.pitch);
        break;
      case 'midTom':
        tone(at, 205, 108, 0.23, 0.76 * volume, 'sine', voice.pitch);
        break;
      case 'highTom':
        tone(at, 285, 155, 0.19, 0.7 * volume, 'sine', voice.pitch);
        break;
    }
  }

  function stepDuration() {
    return 60 / Number(tempo.value) / 4;
  }

  function scheduleStep(step, at) {
    pattern.forEach(function (row, voiceIndex) {
      if (row[step]) triggerVoice(voiceIndex, at);
    });
  }

  function scheduler() {
    if (!isPlaying) return;
    var horizon = audioContext.currentTime + 0.12;
    while (nextStepTime < horizon) {
      scheduleStep(nextStep, nextStepTime);
      nextStep = (nextStep + 1) % 16;
      nextStepTime += stepDuration();
    }
  }

  function updatePlayhead() {
    if (!isPlaying) return;
    var duration = stepDuration();
    var elapsed = Math.max(0, audioContext.currentTime - playbackStart);
    var activeStep = Math.floor(elapsed / duration) % 16;
    document.querySelectorAll('.step.playhead').forEach(function (button) { button.classList.remove('playhead'); });
    document.querySelectorAll('.track.playing').forEach(function (track) { track.classList.remove('playing'); });
    document.querySelectorAll('.steps').forEach(function (row) {
      var step = row.children[activeStep];
      if (step) step.classList.add('playhead');
    });
    document.querySelectorAll('.track').forEach(function (track) {
      track.classList.toggle('playing', Boolean(track.querySelector('.step.playhead.on')));
    });
    animationFrame = window.requestAnimationFrame(updatePlayhead);
  }

  function setPlaybackUi(playing) {
    isPlaying = playing;
    playButton.setAttribute('aria-pressed', String(playing));
    playButton.setAttribute('aria-label', playing ? 'Stop pattern' : 'Play pattern');
    document.getElementById('play-label').textContent = playing ? 'Stop pattern' : 'Play pattern';
    transport.classList.toggle('is-playing', playing);
    visualizerState.textContent = playing ? 'PLAYING' : 'READY';
    if (!playing) {
      window.cancelAnimationFrame(animationFrame);
      document.querySelectorAll('.step.playhead').forEach(function (button) { button.classList.remove('playhead'); });
      document.querySelectorAll('.track.playing').forEach(function (track) { track.classList.remove('playing'); });
    }
  }

  async function startPlayback() {
    try {
      initAudio();
      await audioContext.resume();
      if (audioContext.state !== 'running') throw new Error('Audio could not start. Check your browser audio settings.');
      masterGain.gain.cancelScheduledValues(audioContext.currentTime);
      masterGain.gain.setValueAtTime(0.8, audioContext.currentTime);
      nextStep = 0;
      playbackStart = audioContext.currentTime + 0.06;
      nextStepTime = playbackStart;
      setPlaybackUi(true);
      setStatus('Looping at ' + tempo.value + ' BPM');
      scheduler();
      timer = window.setInterval(scheduler, 25);
      animationFrame = window.requestAnimationFrame(updatePlayhead);
      if (visualizerAnimationFrame === null) visualizerAnimationFrame = window.requestAnimationFrame(drawVisualizer);
    } catch (error) {
      setPlaybackUi(false);
      setStatus(error.message || 'Audio could not start.', true);
    }
  }

  function stopPlayback() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (audioContext) {
      var now = audioContext.currentTime;
      activeSources.slice().forEach(function (source) { source.stop(now); });
    }
    setPlaybackUi(false);
    setStatus('Stopped — your pattern is still here');
  }

  function toggleStep(row, step) {
    pattern[row][step] = pattern[row][step] ? 0 : 1;
    var button = tracks.querySelector('[data-row="' + row + '"][data-step="' + step + '"]');
    var active = Boolean(pattern[row][step]);
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
  }

  function previewVoice(index) {
    try {
      initAudio();
      audioContext.resume().then(function () {
        triggerVoice(index, audioContext.currentTime + 0.01);
      }).catch(function (error) {
        setStatus('Preview could not play: ' + error.message, true);
      });
    } catch (error) {
      setStatus(error.message || 'Preview could not play.', true);
    }
  }

  function drawVisualizer() {
    visualizerAnimationFrame = null;
    if (!canvasContext) return;
    var width = Math.round(canvas.clientWidth * window.devicePixelRatio);
    var height = Math.round(canvas.clientHeight * window.devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvasContext.clearRect(0, 0, width, height);
    if (analyser && isPlaying) analyser.getByteFrequencyData(dataArray);
    var bars = 42;
    var gap = width / bars;
    for (var i = 0; i < bars; i++) {
      var magnitude = isPlaying && analyser ? dataArray[Math.floor(i * dataArray.length / bars)] / 255 : 0;
      var idle = reducedMotion ? 0.025 : (Math.sin(i * 0.49 + performance.now() / 1500) + 1) * 0.018;
      var barHeight = Math.max(2, (magnitude * .8 + idle) * height);
      var x = i * gap + gap * .36;
      var y = (height - barHeight) / 2;
      var color = i < 25 ? 'rgba(255,181,87,' + (0.16 + magnitude * .66) + ')' : 'rgba(244,119,88,' + (0.12 + magnitude * .54) + ')';
      canvasContext.fillStyle = color;
      canvasContext.fillRect(x, y, Math.max(1, gap * .28), barHeight);
    }
    if (!reducedMotion || isPlaying) visualizerAnimationFrame = window.requestAnimationFrame(drawVisualizer);
  }

  playButton.addEventListener('click', function () {
    if (isPlaying) stopPlayback();
    else startPlayback();
  });

  tracks.addEventListener('click', function (event) {
    var stepButton = event.target.closest('.step');
    var previewButton = event.target.closest('[data-preview]');
    if (stepButton) {
      toggleStep(Number(stepButton.dataset.row), Number(stepButton.dataset.step));
    } else if (previewButton) {
      previewVoice(Number(previewButton.dataset.preview));
    }
  });

  mixer.addEventListener('input', function (event) {
    var input = event.target.closest('[data-volume]');
    if (input) {
      var volumeIndex = Number(input.dataset.volume);
      voices[volumeIndex].volume = Number(input.value);
      document.getElementById('level-value-' + voices[volumeIndex].id).textContent = input.value + '%';
      return;
    }
    input = event.target.closest('[data-pitch]');
    if (!input) return;
    var pitchIndex = Number(input.dataset.pitch);
    voices[pitchIndex].pitch = Number(input.value);
    document.getElementById('pitch-value-' + voices[pitchIndex].id).textContent = formatPitch(voices[pitchIndex].pitch);
  });

  tempo.addEventListener('input', function () {
    tempoValue.value = tempo.value;
    tempoValue.textContent = tempo.value;
    if (isPlaying) setStatus('Looping at ' + tempo.value + ' BPM');
  });

  document.getElementById('clear').addEventListener('click', function () {
    pattern = pattern.map(function (row) { return row.map(function () { return 0; }); });
    renderTracks();
  });

  document.getElementById('reset').addEventListener('click', function () {
    pattern = copyPattern(demoPattern);
    voices.forEach(function (voice) {
      voice.volume = voice.defaultVolume;
      if (voice.defaultPitch !== undefined) voice.pitch = voice.defaultPitch;
    });
    tempo.value = '120';
    tempoValue.value = '120';
    tempoValue.textContent = '120';
    renderTracks();
    renderMixer();
    setStatus(isPlaying ? 'Looping at 120 BPM' : 'Demo groove restored');
  });

  window.addEventListener('pagehide', function () {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    activeSources.slice().forEach(function (source) { source.stop(); });
    setPlaybackUi(false);
    if (audioContext && audioContext.state !== 'closed') audioContext.close();
  });

  renderTracks();
  renderMixer();
  tempoValue.value = tempo.value;
  drawVisualizer();
}());
