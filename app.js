const minutesDisplay = document.querySelector('#minutes');
const secondsDisplay = document.querySelector('#seconds');
const startButton = document.querySelector('#startButton');
const resetButton = document.querySelector('#resetButton');
const customMinutes = document.querySelector('#customMinutes');
const presets = [...document.querySelectorAll('.presets button')];
const characterCards = [...document.querySelectorAll('.character-card')];
const nicknameInput = document.querySelector('#nicknameInput');
const taskInput = document.querySelector('#taskInput');
const statusText = document.querySelector('#statusText');
const progressBar = document.querySelector('#progressBar');
const walkCount = document.querySelector('#walkCount');
const createRoomButton = document.querySelector('#createRoomButton');
const copyInviteButton = document.querySelector('#copyInviteButton');
const joinRoomButton = document.querySelector('#joinRoomButton');
const inviteInput = document.querySelector('#inviteInput');
const roomStatus = document.querySelector('#roomStatus');
const roomModal = document.querySelector('#roomModal');
const openRoomButton = document.querySelector('#openRoomButton');
const closeRoomButton = document.querySelector('#closeRoomButton');

let totalSeconds = 25 * 60;
let remainingSeconds = totalSeconds;
let timerId = null;
let deadline = null;
let sessionActive = false;
let steps = 0;
let character = localStorage.getItem('focus-pet-character') || 'hedgehog';
nicknameInput.value = localStorage.getItem('focus-pet-nickname') || '';

function nickname() {
  return nicknameInput.value.trim();
}

function render() {
  minutesDisplay.textContent = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  secondsDisplay.textContent = String(remainingSeconds % 60).padStart(2, '0');
  const progress = totalSeconds > 0 ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100 : 0;
  progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  window.godori.updateTimer({ remainingSeconds, running: Boolean(timerId) });
}

async function selectCharacter(id, announce = true) {
  if (sessionActive) return;
  const card = characterCards.find(item => item.dataset.character === id) || characterCards[0];
  character = card.dataset.character;
  localStorage.setItem('focus-pet-character', character);
  characterCards.forEach(item => {
    const active = item === card;
    item.classList.toggle('active', active);
    item.setAttribute('aria-checked', String(active));
  });
  if (announce && !timerId) statusText.textContent = '선택한 친구와 함께 집중할 준비가 됐어요.';
  await window.godori.selectCharacter(character);
}

function setDuration(value) {
  if (timerId) return;
  const minutes = Math.max(1, Math.min(180, Number(value) || 25));
  totalSeconds = minutes * 60;
  remainingSeconds = totalSeconds;
  customMinutes.value = minutes;
  presets.forEach(button => button.classList.toggle('active', Number(button.dataset.minutes) === minutes));
  render();
}

function startCountdown() {
  clearInterval(timerId);
  deadline = Date.now() + remainingSeconds * 1000;
  const tick = async () => {
    const nextRemaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (nextRemaining !== remainingSeconds) {
      steps += Math.max(1, remainingSeconds - nextRemaining) * Math.round(2 + Math.random() * 4);
      remainingSeconds = nextRemaining;
      walkCount.textContent = `${steps.toLocaleString('ko-KR')} 타이핑`;
      render();
    }
    if (remainingSeconds <= 0) {
      clearInterval(timerId);
      timerId = null;
      deadline = null;
      remainingSeconds = 0;
      startButton.textContent = '완료 대기 중';
      statusText.textContent = '캐릭터 팝업에서 시간을 추가하거나 타이머를 종료해 주세요.';
      render();
      await window.godori.complete();
    }
  };
  timerId = setInterval(tick, 250);
  tick();
}

async function toggleTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
    deadline = null;
    startButton.textContent = '계속 집중';
    statusText.textContent = '잠깐 쉬고 있어요.';
    render();
    await window.godori.pause();
    return;
  }
  if (remainingSeconds <= 0) return;
  sessionActive = true;
  startButton.textContent = '잠깐 쉬기';
  statusText.textContent = taskInput.value.trim()
    ? `“${taskInput.value.trim()}”에 집중하고 있어요.`
    : '선택한 친구와 함께 집중을 시작했어요.';
  await window.godori.start({
    minutes: Math.ceil(remainingSeconds / 60),
    task: taskInput.value.trim(),
    nickname: nickname(),
    character,
  });
  startCountdown();
  render();
}

async function resetTimer() {
  clearInterval(timerId);
  timerId = null;
  deadline = null;
  sessionActive = false;
  remainingSeconds = totalSeconds;
  steps = 0;
  walkCount.textContent = '0 타이핑';
  startButton.textContent = '집중 시작';
  statusText.textContent = '선택한 친구가 집중 시작을 기다리고 있어요.';
  render();
  await window.godori.reset();
}

window.godori.onAddTime(minutes => {
  const addedSeconds = Math.max(1, Math.min(180, Number(minutes) || 1)) * 60;
  totalSeconds = addedSeconds;
  remainingSeconds = addedSeconds;
  customMinutes.value = Math.round(addedSeconds / 60);
  presets.forEach(button => button.classList.remove('active'));
  startButton.textContent = '잠깐 쉬기';
  sessionActive = true;
  statusText.textContent = `${Math.round(addedSeconds / 60)}분 더 집중하고 있어요.`;
  startCountdown();
  render();
});

window.godori.onEndTimer(() => {
  clearInterval(timerId);
  timerId = null;
  deadline = null;
  sessionActive = false;
  remainingSeconds = totalSeconds;
  steps = 0;
  walkCount.textContent = '0 타이핑';
  startButton.textContent = '집중 시작';
  statusText.textContent = '타이머를 종료했어요. 다음 집중을 준비해 주세요.';
  render();
});

window.godori.onWidgetToggle(() => toggleTimer());
window.godori.onRoomStatus(status => {
  roomStatus.textContent = status.message;
  if (status.inviteUrl) {
    inviteInput.value = status.inviteUrl;
    copyInviteButton.disabled = false;
    copyInviteButton.dataset.invite = status.inviteUrl;
  }
});

characterCards.forEach(card => card.addEventListener('click', () => selectCharacter(card.dataset.character)));
presets.forEach(button => button.addEventListener('click', () => setDuration(button.dataset.minutes)));
customMinutes.addEventListener('change', event => setDuration(event.target.value));
nicknameInput.addEventListener('input', () => {
  localStorage.setItem('focus-pet-nickname', nickname());
});
startButton.addEventListener('click', toggleTimer);
resetButton.addEventListener('click', resetTimer);
openRoomButton.addEventListener('click', () => {
  roomModal.hidden = false;
  createRoomButton.focus();
});
closeRoomButton.addEventListener('click', () => { roomModal.hidden = true; });
roomModal.addEventListener('click', event => {
  if (event.target === roomModal) roomModal.hidden = true;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') roomModal.hidden = true;
});
createRoomButton.addEventListener('click', async () => {
  roomStatus.textContent = '방을 만드는 중...';
  await window.godori.createRoom({ nickname: nickname(), character });
});
joinRoomButton.addEventListener('click', async () => {
  roomStatus.textContent = '참여하는 중...';
  await window.godori.joinRoom(inviteInput.value.trim());
});
copyInviteButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(copyInviteButton.dataset.invite || inviteInput.value);
  roomStatus.textContent = '초대 링크를 복사했어요.';
});
selectCharacter(character, false);
render();
