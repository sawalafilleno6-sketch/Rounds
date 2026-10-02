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

