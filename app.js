const $ = (id) => document.getElementById(id);
const storeKey = 'xiaohei-review-v1';
let data, points = [], state = { done: {}, practiceDone: {}, notes: {}, quoteNotes: {}, stats: {}, learnedOn: {}, reviews: {}, sound: true };
let pathMode = 'memorize', lesson = null, lessonMode = 'new', queue = [], index = 0, session = { correct: 0, wrong: 0, answered: 0 }, activeQuestion = null;
let audioContext;
let selectedQuote = null;
const reviewIntervals = [1, 2, 4, 7, 15, 30];
function todayKey() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function addDays(day,n) { const [y,m,d]=day.split('-').map(Number), date=new Date(y,m-1,d); date.setDate(date.getDate()+n); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function reviewDue(p,today=todayKey()) {
  const learned=state.learnedOn[p.id]; if(!learned || learned>=today) return false;
  const review=state.reviews[p.id]||{dates:[]};
  if(review.dates.includes(today)) return false;
  const latest=review.dates.at(-1)||learned;
  return reviewIntervals.some(n=>{const due=addDays(learned,n);return due<=today && due>latest;}) || !!(review.lastWrong && addDays(review.lastWrong,1)<=today);
}

function save() { localStorage.setItem(storeKey, JSON.stringify(state)); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function inline(s) { return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function theoryHtml(md, title='') { return md.split('\n').filter((line,i)=>!(i===0 && line.replace(/^#{3,6}\s+/, '')===title)).map(line => { if (!line.trim()) return ''; const h = line.match(/^#{3,6}\s+(.+)$/); return h ? `<h3>${inline(h[1])}</h3>` : `<p>${inline(line)}</p>`; }).join(''); }
function view(name) { for (const v of ['path','lesson','notes']) $(`${v}View`).classList.toggle('hidden', v !== name); document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name)); if (name === 'notes') renderNotes(); if (name === 'path') renderPath(); scrollTo(0,0); }
function doneMap() { return pathMode==='practice'?state.practiceDone:state.done; }
function chapterDone(c) { return c.points.filter(p => doneMap()[p.id]).length; }
function notedPointIds() { return new Set(points.filter(p=>state.notes[p.id] || (state.quoteNotes[p.id]||[]).length).map(p=>p.id)); }
function quoteMarkdown(range) {
  function walk(node) {
    if(node.nodeType===Node.TEXT_NODE) return node.textContent;
    if(node.nodeType!==Node.ELEMENT_NODE && node.nodeType!==Node.DOCUMENT_FRAGMENT_NODE) return '';
    const body=Array.from(node.childNodes).map(walk).join('');
    if(node.nodeName==='STRONG' || node.nodeName==='B') return `**${body}**`;
    if(['P','H2','H3','BR'].includes(node.nodeName)) return `${body}\n`;
    return body;
  }
  const start=range.startContainer.nodeType===Node.TEXT_NODE?range.startContainer.parentElement:range.startContainer;
  const end=range.endContainer.nodeType===Node.TEXT_NODE?range.endContainer.parentElement:range.endContainer;
  const content=walk(range.cloneContents()).replace(/\n{3,}/g,'\n\n').trim();
  return start.closest('strong,b') && start.closest('strong,b')===end.closest('strong,b') ? `**${content}**` : content;
}
function updateSelectionButton() {
  const selection=window.getSelection(), b=$('selectionSave');
  if(!lesson || $('lessonView').classList.contains('hidden') || !selection || selection.isCollapsed) { b.classList.add('hidden'); selectedQuote=null; return; }
  const range=selection.getRangeAt(0), container=range.commonAncestorContainer.nodeType===Node.ELEMENT_NODE?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  if(!container.closest('#theoryContent, #previewQuestions, #questionText')) { b.classList.add('hidden'); selectedQuote=null; return; }
  const plain=selection.toString().trim(); if(plain.length<2 || plain.length>600) { b.classList.add('hidden'); selectedQuote=null; return; }
  const markdown=quoteMarkdown(range); const theoryPlain=lesson.theory.replace(/\*\*/g,'').replace(/^#{3,6}\s+/gm,'');
  let order=theoryPlain.indexOf(plain);
  if(order<0) order=theoryPlain.length+Math.max(0,lesson.questions.findIndex(q=>q.text.includes(plain)))*1000;
  selectedQuote={pointId:lesson.id,markdown,plain,order};
  const box=range.getBoundingClientRect(); b.style.left=`${Math.max(12,Math.min(window.innerWidth-125,box.left+box.width/2-54))}px`; b.style.top=`${Math.max(12,box.top-48)}px`;
  b.classList.remove('hidden');
}
function saveSelection() {
  if(!selectedQuote)return;
  const {pointId,markdown,plain,order}=selectedQuote, list=state.quoteNotes[pointId]||[];
  if(!list.some(q=>q.plain===plain)) list.push({markdown,plain,order});
  state.quoteNotes[pointId]=list; save();
  $('selectionSave').textContent='已加入';
  setTimeout(()=>{ $('selectionSave').classList.add('hidden'); $('selectionSave').textContent='加入笔记'; },700);
  window.getSelection()?.removeAllRanges(); selectedQuote=null;
}
function tone(frequency, start, duration, volume) {
  if (!state.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start); oscillator.stop(start + duration + 0.01);
  } catch { /* Audio is optional when the browser blocks it. */ }
}
function playSound(type) {
  if (!state.sound) return;
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  const now = audioContext.currentTime + 0.005;
  if (type === 'correct') { tone(660, now, 0.11, 0.045); tone(880, now + 0.075, 0.15, 0.04); }
  if (type === 'wrong') tone(330, now, 0.15, 0.028);
  if (type === 'done') { tone(587, now, 0.12, 0.04); tone(784, now + 0.11, 0.12, 0.04); tone(988, now + 0.22, 0.2, 0.04); }
}
function updateSoundToggle() { const b=$('soundToggle'); b.textContent=state.sound?'♫':'♪'; b.setAttribute('aria-label',state.sound?'关闭音效':'开启音效'); b.setAttribute('aria-pressed',String(state.sound)); b.classList.toggle('muted',!state.sound); }
function renderPath() {
  const all = points.length, done = Object.keys(doneMap()).filter(k => doneMap()[k]).length;
  const currentId = points.find(p => !doneMap()[p.id])?.id;
  $('pathModeLabel').textContent=pathMode==='practice'?'刷题模式':'背题模式';
  $('dailyTask').classList.toggle('hidden',pathMode==='practice');
  $('memorizeMode').classList.toggle('active',pathMode==='memorize'); $('memorizeMode').setAttribute('aria-pressed',String(pathMode==='memorize'));
  $('practiceMode').classList.toggle('active',pathMode==='practice'); $('practiceMode').setAttribute('aria-pressed',String(pathMode==='practice'));
  if(pathMode==='memorize') renderDailyTask();
  $('totalProgress').textContent = `${done} / ${all}`; $('masteredCount').textContent = done;
  $('savedCount').textContent = notedPointIds().size;
  $('noteBadge').textContent = notedPointIds().size || '';
  $('railProgress').textContent = `${Math.round(done / all * 100) || 0}%`;
  $('railBar').style.width = `${done / all * 100 || 0}%`;
  $('railNotes').textContent = `${notedPointIds().size} 个知识点`;
  let lastPart = '';
  $('pathContent').innerHTML = data.chapters.map(c => {
    const part = c.part !== lastPart ? `<div class="part-label">${escapeHtml(c.part)}</div>` : '';
    lastPart = c.part;
    const nodes = c.points.map(p => `<div class="node-row"><button class="node ${doneMap()[p.id] ? 'done' : p.id === currentId ? 'current' : ''}" data-point="${p.id}" aria-label="开始 ${escapeHtml(p.title)}">${doneMap()[p.id] ? '✓' : '<svg class="node-star" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 L28.7 18.3 L43 18.7 L31.7 27.3 L35.7 41 L24 32.8 L12.3 41 L16.3 27.3 L5 18.7 L19.3 18.3 Z" fill="currentColor" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>'}</button><div class="node-label"><strong>${escapeHtml(p.title)}</strong>${p.questions.length} 道题</div></div>`).join('');
    return `${part}<div class="chapter"><div class="chapter-header"><h2>${escapeHtml(c.title)}</h2><span>${chapterDone(c)} / ${c.points.length}</span></div><div class="path-nodes">${nodes}</div></div>`;
  }).join('');
  document.querySelectorAll('[data-point]').forEach(b => b.onclick = () => openLesson(points.find(p => p.id === b.dataset.point),pathMode==='practice'?'practice':'new'));
}
function renderDailyTask() {
  const today=todayKey(), due=points.filter(p=>reviewDue(p,today));
  const next=points.find(p=>!state.done[p.id]);
  const newDone=points.filter(p=>state.learnedOn[p.id]===today).length;
  const reviewItem=p=>`<button class="daily-item" data-review="${p.id}"><span class="daily-item-mark">↻</span><span><strong>${escapeHtml(p.title)}</strong><small>${escapeHtml(p.chapter)}</small></span></button>`;
  $('dailyTask').innerHTML=`<div class="daily-heading"><h2>今日任务</h2><span>${due.length} 关待复习</span></div><div class="daily-grid"><div class="daily-group"><div class="daily-label">复习</div>${due.length?due.map(reviewItem).join(''):'<div class="daily-empty">今天的复习已完成</div>'}</div><div class="daily-group"><div class="daily-label">新学 ${newDone ? `· 已完成 ${newDone}` : ''}</div>${next?`<button class="daily-item" data-new="${next.id}"><span class="daily-item-mark new">★</span><span><strong>${escapeHtml(next.title)}</strong><small>${escapeHtml(next.chapter)}</small></span></button>`:'<div class="daily-empty">全部关卡已学完</div>'}</div></div>`;
  document.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>openLesson(points.find(p=>p.id===b.dataset.review),'review'));
  document.querySelector('[data-new]')?.addEventListener('click',e=>openLesson(points.find(p=>p.id===e.currentTarget.dataset.new)));
}
function updateSaveButtons() { for (const id of ['savePointIntro','savePointQuiz']) { const b=$(id); b.classList.toggle('saved', !!state.notes[lesson.id]); b.textContent = state.notes[lesson.id] ? '已加入笔记' : '加入笔记'; } }
function toggleNote() { state.notes[lesson.id] = !state.notes[lesson.id]; save(); updateSaveButtons(); }
function openLesson(p,mode='new') {
  lesson = p; lessonMode=mode; queue = []; index = 0; session = {correct:0,wrong:0,answered:0};
  $('selectionSave').classList.add('hidden'); selectedQuote=null;
  $('lessonMeta').textContent = `${p.part} · ${p.chapter}`;
  $('lessonTitle').textContent = p.title;
  $('theoryContent').innerHTML = theoryHtml(p.theory,p.title);
  $('previewQuestions').innerHTML = p.questions.map(q => `<div class="preview-item"><span>${q.number}.</span><div>${escapeHtml(q.text)} <span class="preview-answer ${q.answer==='√'?'':'correction'}">【${escapeHtml(q.answer)}】</span></div></div>`).join('');
  $('introPanel').classList.toggle('hidden',mode==='review'||mode==='practice'); $('quizPanel').classList.add('hidden'); $('donePanel').classList.add('hidden');
  $('savePointQuiz').classList.toggle('hidden',mode==='practice');
  $('lessonCounter').textContent = `0 / ${p.questions.length}`; $('lessonBar').style.width='0%'; updateSaveButtons(); view('lesson');
  if(mode==='review'||mode==='practice') beginQuiz();
}
function beginQuiz() {
  const base=lesson.questions.map((_,qi)=>({qi,pass:0}));
  const repeats=lessonMode==='review' ? lesson.questions.flatMap((q,qi)=>state.stats[`${lesson.id}:${q.number}`]?.wrong ? [{qi,pass:1}] : []) : [];
  queue=[...base,...repeats]; index=0; session={correct:0,wrong:0,answered:0}; $('introPanel').classList.add('hidden'); $('quizPanel').classList.remove('hidden'); showQuestion();
}
function showQuestion() {
  if (index >= queue.length) return finishQuiz();
  const {qi}=queue[index], q=lesson.questions[qi]; activeQuestion=q;
  $('redoNotice').classList.toggle('hidden',!queue[index].retry || !!queue[index-1]?.retry);
  $('questionNumber').textContent = `第 ${q.number} 题 · ${index+1} / ${queue.length}`;
  $('questionText').textContent=q.text;
  $('lessonCounter').textContent=`${index} / ${queue.length}`;
  $('lessonBar').style.width=`${index/queue.length*100}%`;
  document.querySelectorAll('.choice').forEach(b=>{b.disabled=false;b.className='choice'});
  $('feedback').className='feedback hidden'; $('feedback').innerHTML=''; $('nextQuestion').classList.add('hidden');
  $('nextQuestion').textContent='继续';
}
function answer(selected, button) {
  const q=activeQuestion, right=q.answer==='√', correct=selected===right;
  playSound(correct?'correct':'wrong');
  session.answered++; if(correct) session.correct++; else session.wrong++;
  const key=`${lessonMode==='practice'?'practice:':''}${lesson.id}:${q.number}`, stat=state.stats[key]||{right:0,wrong:0};
  stat[correct?'right':'wrong']++; state.stats[key]=stat; save();
  button.classList.add('selected',correct?'correct':'wrong');
  document.querySelectorAll('.choice').forEach(b=>b.disabled=true);
  const feedback=$('feedback'); feedback.className=`feedback ${correct?'':'wrong'}`;
  feedback.innerHTML=correct ? '答对了' : `正确答案：${right?'正确':'错误'}${right?'':`<br>应改为：${escapeHtml(q.answer)}`}`;
  $('nextQuestion').classList.remove('hidden');
  if (!correct) queue.push({qi:queue[index].qi,retry:true});
  $('nextQuestion').textContent=queue[index+1]?.retry && !queue[index].retry?'重做错题':'继续';
}
function finishQuiz() {
  playSound('done');
  const today=todayKey();
  if(lessonMode==='practice') state.practiceDone[lesson.id]=true;
  else if(!state.done[lesson.id]) state.learnedOn[lesson.id]=today;
  else if(lessonMode==='review') {
    const review=state.reviews[lesson.id]||{dates:[]};
    if(!review.dates.includes(today)) review.dates.push(today);
    review.lastWrong=session.wrong?today:null;
    state.reviews[lesson.id]=review;
  }
  if(lessonMode!=='practice') state.done[lesson.id]=true;
  save(); $('quizPanel').classList.add('hidden'); $('donePanel').classList.remove('hidden');
  $('lessonCounter').textContent=`${queue.length} / ${queue.length}`; $('lessonBar').style.width='100%';
  $('doneTitle').textContent=lesson.title; $('doneStats').textContent=`答对 ${session.correct} 题 · 错题 ${session.wrong} 次`;
}
function renderNotes() {
  const selected=points.filter(p=>state.notes[p.id] || (state.quoteNotes[p.id]||[]).length);
  $('notesContent').innerHTML = selected.length ? data.chapters.map(c=>{
    const cp=c.points.filter(p=>state.notes[p.id] || (state.quoteNotes[p.id]||[]).length); if(!cp.length)return '';
    return `<div class="note-part">${escapeHtml(c.part)}</div><section class="note-chapter"><h2>${escapeHtml(c.title)}</h2>${cp.map(p=>`<article class="note-point"><div class="note-point-head"><h3>${escapeHtml(p.title)}</h3><button class="remove-note" data-remove="${p.id}" aria-label="移除 ${escapeHtml(p.title)}">移除</button></div>${(state.quoteNotes[p.id]||[]).sort((a,b)=>a.order-b.order).map(q=>`<div class="note-quote">${inline(q.markdown).replace(/\n/g,'<br>')}</div>`).join('')}${state.notes[p.id]?`<div class="theory-content">${theoryHtml(p.theory,p.title)}</div>`:''}</article>`).join('')}</section>`;
  }).join('') : '<div class="empty-notes"><div class="empty-icon">▤</div><p>还没有笔记</p></div>';
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{delete state.notes[b.dataset.remove];delete state.quoteNotes[b.dataset.remove];save();renderNotes();});
}
async function init() {
  data=await fetch('data.json').then(r=>r.json());
  points=data.chapters.flatMap(c=>c.points.map(p=>({...p,chapter:c.title,part:c.part})));
  try { const old=JSON.parse(localStorage.getItem(storeKey)); if(old && typeof old==='object') state={...state,...old}; } catch {}
  state.learnedOn ||= {}; state.reviews ||= {}; state.quoteNotes ||= {}; state.practiceDone ||= {};
  for(const p of points) if(state.done[p.id] && !state.learnedOn[p.id]) state.learnedOn[p.id]=todayKey();
  save();
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
  $('openNotes').onclick=()=>view('notes'); $('backPath').onclick=()=>view('path');
  $('savePointIntro').onclick=toggleNote; $('savePointQuiz').onclick=toggleNote;
  $('startQuestions').onclick=beginQuiz;
  document.querySelectorAll('.choice').forEach(b=>b.onclick=()=>answer(b.dataset.answer==='true',b));
  $('nextQuestion').onclick=()=>{index++;showQuestion()};
  $('finishLesson').onclick=()=>view('path'); $('retryLesson').onclick=()=>openLesson(lesson,lessonMode);
  $('printNotes').onclick=()=>window.print();
  $('soundToggle').onclick=()=>{state.sound=!state.sound;save();updateSoundToggle();};
  $('memorizeMode').onclick=()=>{pathMode='memorize';renderPath();};
  $('practiceMode').onclick=()=>{pathMode='practice';renderPath();};
  document.addEventListener('mouseup',updateSelectionButton);
  document.addEventListener('keyup',updateSelectionButton);
  document.addEventListener('touchend',()=>setTimeout(updateSelectionButton,100));
  $('selectionSave').addEventListener('pointerdown',e=>e.preventDefault());
  $('selectionSave').onclick=saveSelection;
  updateSoundToggle();
  renderPath();
}
init();
