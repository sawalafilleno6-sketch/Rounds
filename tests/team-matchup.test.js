const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');

function sourceFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

function matchupHarness() {
  const functions = ['validTeamIndex', 'setTeamMatch', 'startTeamMatchup']
    .map(sourceFunction).join('\n');
  const context = { parseInt, Number };
  vm.runInNewContext(`
    let state;
    let rendered = 0;
    let judged = 0;
    function renderTeamMatchup(){ rendered++; }
    function renderJudgeTeam(){ judged++; }
    function scheduleSaveProgress(){}
    function pairKey(a,b){ return [a,b].sort((x,y)=>x-y).join(':'); }
    function interleaveTeams(){ return []; }
    ${functions}
    globalThis.setState = value => { state = value; };
    globalThis.snapshot = () => ({ state, rendered, judged });
  `, context);
  return context;
}

test('same-team selection remains visible and cannot begin a matchup', () => {
  const app = matchupHarness();
  app.setState({ teamCount: 3, teamMatch: { a: 0, b: 1 }, tournament: { completedPairs: [] } });

  app.setTeamMatch('a', '1');
  let view = app.snapshot();
  assert.deepEqual(view.state.teamMatch, { a: 1, b: 1 });
  assert.equal(view.state.matchupError, 'Choose two different teams.');

  app.startTeamMatchup();
  view = app.snapshot();
  assert.deepEqual(view.state.teamMatch, { a: 1, b: 1 });
  assert.equal(view.judged, 0);
});

test('swap sides reverses a valid team matchup', () => {
  const swap = sourceFunction('swapTeamMatch');
  assert.ok(swap, 'swapTeamMatch must exist');
  const app = matchupHarness();
  vm.runInNewContext(`${swap}\nglobalThis.swapTeamMatch = swapTeamMatch;`, app);
  app.setState({ teamCount: 3, teamMatch: { a: 0, b: 2 }, tournament: { completedPairs: [] } });

  app.swapTeamMatch();
  const view = app.snapshot();
  assert.equal(view.state.teamMatch.a, 2);
  assert.equal(view.state.teamMatch.b, 0);
});

function dancerDisplayHarness(){
  const functions = ['boundedInt', 'teamMemberNumber', 'teamDancerLabel', 'teamBattleColor']
    .map(sourceFunction).join('\n');
  const context = { PALETTE: [{hex:'#5BC0EB'}, {hex:'#FDE74C'}] };
  vm.runInNewContext(`
    let state;
    function teamName(i){ return ['Team 1','Team 2','Team 3'][i]; }
    ${functions}
    globalThis.setState = value => { state = value; };
    globalThis.memberNumber = typeof teamMemberNumber === 'function' ? teamMemberNumber : null;
    globalThis.label = typeof teamDancerLabel === 'function' ? teamDancerLabel : null;
    globalThis.color = typeof teamBattleColor === 'function' ? teamBattleColor : null;
  `, context);
  return context;
}

test('team labels use each dancer’s number within their own team', () => {
  const app = dancerDisplayHarness();
  assert.equal(typeof app.memberNumber, 'function');
  assert.equal(typeof app.label, 'function');
  app.setState({ format:'team', perTeam: 3, teamMatch: {a:0,b:1} });
  const dancer = { id:'d5', number:5, teamIndex:1 };

  assert.equal(app.memberNumber(dancer), 2);
  assert.equal(app.label(dancer), 'Dancer #2 Team 2');
  assert.equal(dancer.id, 'd5');
});

test('matchup side colors follow the selected teams, including reversed sides', () => {
  const app = dancerDisplayHarness();
  assert.equal(typeof app.color, 'function');
  const team1 = { id:'d1', number:1, teamIndex:0, color:{hex:'#5BC0EB'} };
  const team2 = { id:'d4', number:4, teamIndex:1, color:{hex:'#FDE74C'} };
  const team3 = { id:'d7', number:7, teamIndex:2, color:{hex:'#5BC0EB'} };

  app.setState({ format:'team', teamMatch:{a:0,b:2} });
  assert.equal(app.color(team1), '#5BC0EB');
  assert.equal(app.color(team3), '#FDE74C');
  app.setState({ format:'team', teamMatch:{a:2,b:0} });
  assert.equal(app.color(team3), '#5BC0EB');
  assert.equal(app.color(team1), '#FDE74C');
  app.setState({ format:'team', teamMatch:{a:0,b:1} });
  assert.equal(app.color(team2), '#FDE74C');
});

test('resuming a tournament retains partial scores and folds them into team averages', () => {
  const functions = ['boundedInt', 'pairKey', 'makeTeamStats', 'createTournament', 'validTeamIndex', 'validAverage', 'updateTournamentStats', 'normalizeTournament']
    .map(sourceFunction).join('\n');
  const context = { state: { teamCount: 3 } };
  vm.runInNewContext(`${functions}\nglobalThis.normalize = normalizeTournament;`, context);
  const saved = {
    matches: [{a:0,b:1,averages:{0:'20.0',1:'24.0'},scoredCount:{0:3,1:3},completedAt:'2026-09-20T12:00:00.000Z'}],
    incompleteMatches: [{a:0,b:2,averages:{0:'28.0',2:'32.0'},scoredCount:{0:1,2:1},completedAt:'2026-09-20T13:00:00.000Z',early:true,incomplete:true}]
  };

  const resumed = context.normalize(saved);
  assert.equal(resumed.incompleteMatches.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(resumed.incompleteMatches[0].averages)), {0:'28.0',2:'32.0'});
  assert.equal(resumed.teamStats[0].matchCount, 2);
  assert.equal(resumed.teamStats[0].cumulativeAverage, 24);
  assert.equal(resumed.teamStats[2].matchCount, 1);
  assert.equal(resumed.teamStats[2].cumulativeAverage, 32);
  assert.equal(resumed.teamStats[2].wins, 0);
});

test('history renders stored text as text rather than executable markup', () => {
  const functions = ['esc', 'safeHex', 'fmtTime', 'historyFormatLabel', 'historyRecordCard']
    .map(sourceFunction).join('\n');
  const context = { FORMAT_LABELS: {'team':'Team Battle'} };
  vm.runInNewContext(`${functions}\nglobalThis.renderCard = historyRecordCard;`, context);
  const html = context.renderCard({format:'<img src=x onerror=alert(1)>',startedAt:'2026-09-20T12:00:00Z',rows:[{
    colorHex:'red',teamName:'<img src=x onerror=alert(2)>',note:'<script>alert(3)</script>',comment:'<svg onload=alert(4)>',score:'<b>unsafe</b>'
  }],teamMatches:[{teams:['<svg onload=alert(5)>','Team 2'],averages:['19.0','20.0'],partial:false}]},0);

  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<svg'), false);
  assert.equal(html.includes('&lt;img'), true);
  assert.equal(html.includes('&lt;b&gt;unsafe'), true);
  assert.equal(html.includes('&lt;svg'), true);
  assert.equal(html.includes('19.0 vs 20.0'), true);
});

test('resuming a battle canonicalizes dancer IDs while keeping valid saved scores', () => {
  const functions = ['boundedInt', 'freshState', 'defaultTeamName', 'colorFor', 'makeDancers', 'makeTeamStats', 'pairKey', 'createTournament', 'validTeamIndex', 'validAverage', 'updateTournamentStats', 'normalizeTournament', 'applyTeamJudgeColors', 'resumeBattle']
    .map(sourceFunction).join('\n');
  const context = { PALETTE:[{hex:'#5BC0EB'},{hex:'#FDE74C'}], CRITERIA:['Musicality','Technique','Originality','Execution'] };
  vm.runInNewContext(`
    let state;
    function showScreen(){}
    function renderJudgeTeam(){}
    function renderTeamMatchup(){}
    ${functions}
    globalThis.resume = resumeBattle;
    globalThis.snapshot = () => state;
  `, context);
  context.resume({format:'team',teamCount:2,perTeam:3,teamNames:['Team 1','Team 2'],teamMatch:{a:0,b:1},
    dancers:[{id:'d1',tag:'safe note'},{id:'d2\');alert(1);//',tag:'bad id'}],
    teamOrder:['d1','d2\');alert(1);//','d4'],teamIndex:0,scores:{d1:{c:[4,5,6,7],comment:'saved',scoredAt:'2026-09-20T12:00:00Z'},"d2');alert(1);//":{c:[10,10,10,10]}}});

  const resumed = context.snapshot();
  assert.deepEqual(Array.from(resumed.dancers, d=>d.id), ['d1','d2','d3','d4','d5','d6']);
  assert.equal(resumed.dancers[0].tag, 'safe note');
  assert.deepEqual(Array.from(resumed.teamOrder), ['d1','d4']);
  assert.equal(resumed.scores.d1.total, 22);
  assert.equal(resumed.scores["d2');alert(1);//"], undefined);
});
