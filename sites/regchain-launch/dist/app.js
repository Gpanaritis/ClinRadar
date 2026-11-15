'use strict';

const scenarios = {
  regulation: {
    title: 'UK labelling rules change',
    status: 'Sample data',
    description: 'An updated labelling requirement puts the next UK dispatch at risk. The study team needs to confirm which kits it can use.',
    metrics: [['7', 'studies need action'], ['12', 'batches need review'], ['6', 'shipments need action']],
    source: {
      label: 'MHRA labelling transition guidance',
      url: 'https://www.gov.uk/guidance/clinical-trials-for-medicines-clinical-trials-regulations-transitional-arrangements#transitional-arrangements-for-labelling-of-investigational-medicinal-products',
      context: 'The regulatory source is real. The portfolio and response options are illustrative.'
    },
    options: [
      {
        title: 'Use UK-ready stock',
        summary: 'Reallocate eligible kits to the next dispatch.',
        state: 'pass',
        result: 'Recommended for review',
        reason: 'The replacement stock meets the sample label, quantity and delivery-window checks.',
        checks: [['Destination label', 'The replacement lot matches the UK country specification in the example.'], ['Available stock', 'The depot has enough unreserved kits to cover the dispatch.'], ['Review owner', 'Clinical Supply reviews the allocation. Regulatory Affairs reviews the rule and Quality handles any follow-up.']]
      },
      {
        title: 'Relabel the planned batch',
        summary: 'Keep the allocation and schedule a label update.',
        state: 'review',
        result: 'Misses the dispatch cutoff',
        reason: 'The next qualified relabelling slot comes after the preparation deadline.',
        checks: [['Destination label', 'Updated artwork is available in the sample.'], ['Depot capacity', 'The available relabelling slot falls after the preparation cutoff.'], ['Review owner', 'Clinical Supply and Quality review any change to the dispatch plan.']]
      }
    ]
  },
  weather: {
    title: 'Severe weather closes the planned hub',
    status: 'Expansion preview',
    description: 'A fictional storm closes the Frankfurt transfer hub. A cold-chain shipment is due at two sites before their next planned visits.',
    metrics: [['1', 'study affected'], ['2', 'sites due stock'], ['1', 'lane disrupted']],
    source: {
      label: 'Simulated weather alert and carrier notice',
      context: 'The notice covers the planned Frankfurt transfer window. All conditions and times in this case are illustrative.'
    },
    options: [
      {
        title: 'Reroute via Amsterdam',
        summary: 'Use an alternate qualified cold-chain lane.',
        state: 'pass',
        result: 'Recommended for review',
        reason: 'The alternate lane avoids the closure and meets the sample transit and site delivery windows.',
        checks: [['Route availability', 'The alternate hub is open and the carrier has a sample booking slot.'], ['Cold-chain check', 'The example transit estimate stays within the qualified packaging duration.'], ['Review owner', 'Logistics confirms capacity and site acceptance. Quality reviews the proposed lane change.']]
      },
      {
        title: 'Wait for Frankfurt to reopen',
        summary: 'Hold the shipment at the origin depot.',
        state: 'review',
        result: 'Delivery window at risk',
        reason: 'The estimated reopening pushes delivery beyond one site’s sample stock window.',
        checks: [['Depot hold', 'Storage at the origin remains available in the sample.'], ['Site stock window', 'Projected delivery falls after one site’s latest acceptable date.'], ['Review owner', 'Clinical Operations reviews any proposed visit adjustment with the site.']]
      }
    ]
  },
  transport: {
    title: 'A carrier cancels the next departure',
    status: 'Expansion preview',
    description: 'A fictional carrier cancellation puts two replenishment shipments at risk. One site has enough stock to absorb the delay.',
    metrics: [['2', 'shipments affected'], ['1', 'site needs stock first'], ['1', 'qualified alternate']],
    source: {
      label: 'Simulated carrier cancellation',
      context: 'The carrier cancels the scheduled Brussels departure in the sample.'
    },
    options: [
      {
        title: 'Prioritize the low-stock site',
        summary: 'Book a qualified alternate for the critical shipment.',
        state: 'pass',
        result: 'Recommended for review',
        reason: 'The alternate carrier has capacity for the urgent shipment. The second site has stock through its revised delivery date.',
        checks: [['Carrier qualification', 'The alternate carrier and lane are approved in the sample.'], ['Site inventory', 'Both sites have enough stock through their proposed delivery dates.'], ['Review owner', 'Clinical Supply reviews the revised allocation and Logistics confirms the booking.']]
      },
      {
        title: 'Rebook both together',
        summary: 'Wait for the carrier’s next shared departure.',
        state: 'review',
        result: 'Site stock coverage falls short',
        reason: 'The next shared departure arrives after the urgent site’s projected stock runs out.',
        checks: [['Carrier availability', 'The next shared departure can take both shipments.'], ['Site inventory', 'One site’s projected stock runs out before delivery.'], ['Review owner', 'Clinical Supply and Clinical Operations review the proposed timing with the site.']]
      }
    ]
  }
};

const byId = id => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll('[data-scenario]'));
const panel = byId('scenario-panel');
const options = byId('options');
let activeScenario;
let activeOption;

function renderOption(index) {
  activeOption = activeScenario.options[index];
  byId('result').dataset.state = activeOption.state;
  byId('result-icon').querySelector('use').setAttribute('href', activeOption.state === 'pass' ? '#i-check' : '#i-alert');
  byId('result-title').textContent = activeOption.result;
  byId('result-text').textContent = activeOption.reason;

  const evidence = byId('evidence-list');
  const { source } = activeScenario;
  const details = [['Source', source.context], ...activeOption.checks];
  evidence.replaceChildren(...details.map(([label, explanation], rowIndex) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    if (rowIndex === 0 && source.url) {
      const link = document.createElement('a');
      link.href = source.url;
      link.textContent = source.label;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      description.append(link, ' · ');
    } else if (rowIndex === 0) {
      description.append(`${source.label}. `);
    }
    description.append(explanation);
    row.append(term, description);
    return row;
  }));
}

function selectTab(tab) {
  for (const button of tabs) {
    button.setAttribute('aria-selected', button === tab);
    button.tabIndex = button === tab ? 0 : -1;
  }
  activeScenario = scenarios[tab.dataset.scenario];
  panel.setAttribute('aria-labelledby', tab.id);
  byId('scenario-title').textContent = activeScenario.title;
  byId('scenario-description').textContent = activeScenario.description;
  byId('scenario-status').textContent = activeScenario.status;
  byId('evidence').open = false;

  byId('scenario-metrics').replaceChildren(...activeScenario.metrics.map(([value, label]) => {
    const metric = document.createElement('div');
    const count = document.createElement('strong');
    const description = document.createElement('span');
    count.textContent = value;
    description.textContent = label;
    metric.append(count, description);
    return metric;
  }));

  options.replaceChildren(...activeScenario.options.map((option, index) => {
    const card = document.createElement('label');
    card.className = 'option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'response';
    input.value = index;
    input.checked = index === 0;
    const text = document.createElement('span');
    const title = document.createElement('strong');
    const summary = document.createElement('small');
    title.textContent = option.title;
    summary.textContent = option.summary;
    text.append(title, summary);
    card.append(input, text);
    return card;
  }));

  renderOption(0);
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const keys = { ArrowUp: (index + tabs.length - 1) % tabs.length, ArrowDown: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 };
    const next = tabs[keys[event.key]];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    next.focus();
  });
}

options.addEventListener('change', event => renderOption(Number(event.target.value)));
selectTab(tabs[0]);

byId('download').addEventListener('click', () => {
  const { title, status, description, metrics, source } = activeScenario;
  const record = {
    recordType: 'Illustrative RegChain decision record',
    scenario: { title, status, description, impact: Object.fromEntries(metrics.map(([value, label]) => [label, Number(value)])), source },
    response: activeOption,
    reviewStatus: 'Example only. No workflow action taken.'
  };
  const file = new Blob([JSON.stringify(record, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'regchain-example-decision.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
});

const screenshotDialog = byId('screenshot-dialog');
byId('open-screen').addEventListener('click', () => screenshotDialog.showModal());
screenshotDialog.addEventListener('click', event => {
  if (event.target === screenshotDialog) screenshotDialog.close();
});

// Schematic coastline and node positions share a 600 × 320 drawing space.
const coastline = [
  [[249,176],[261,149],[257,129],[272,120],[267,104],[279,99],[284,85],[305,76],[310,60],[317,49],[324,31],[343,11],[373,0],[395,0],[396,19],[379,38],[376,58],[386,63],[402,45],[416,27],[438,21],[449,39],[434,59],[433,77],[445,83],[459,74],[481,80],[504,67],[529,74],[545,62],[570,76],[600,69],[600,276],[555,262],[543,249],[509,264],[497,255],[481,259],[465,267],[454,250],[432,246],[429,228],[409,221],[402,207],[385,212],[394,232],[414,246],[410,264],[392,249],[372,235],[358,213],[338,204],[327,208],[308,219],[300,236],[275,254],[245,256],[225,248],[216,225],[216,206],[227,198],[246,201]],
  [[191,116],[183,104],[185,89],[198,78],[194,66],[209,54],[219,56],[212,75],[224,85],[221,104],[233,111],[228,130],[210,138],[190,135]],
  [[159,107],[166,92],[177,94],[183,106],[173,124],[152,125],[146,116]],
  [[208,298],[229,281],[264,278],[291,287],[323,282],[353,274],[376,288],[406,281],[440,289],[468,307],[518,311],[560,302],[600,310],[600,320],[198,320]]
];

const canvas = byId('route-map');
const context = canvas.getContext('2d');

function drawRouteMap() {
  const { clientWidth: width, clientHeight: height } = canvas;
  const pixelRatio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  context.setTransform(canvas.width / 600, 0, 0, canvas.height / 320, 0, 0);

  context.strokeStyle = '#557cb32d';
  context.lineWidth = .65;
  for (let x = 0; x < 600; x += 28) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 320);
    context.stroke();
  }
  for (let y = 12; y < 320; y += 28) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(600, y);
    context.stroke();
  }

  const land = new Path2D();
  for (const outline of coastline) {
    land.moveTo(...outline[0]);
    for (const point of outline.slice(1)) land.lineTo(...point);
    land.closePath();
  }

  const tint = context.createLinearGradient(150, 270, 600, 10);
  tint.addColorStop(0, '#365e9547');
  tint.addColorStop(.7, '#365e955b');
  tint.addColorStop(1, '#27477e23');
  context.fillStyle = tint;
  context.fill(land);
  context.strokeStyle = '#5b87ba70';
  context.stroke(land);
  context.save();
  context.clip(land);
  context.fillStyle = '#82a8de37';
  for (let y = 0; y < 320; y += 6) {
    for (let x = 130; x < 600; x += 6) context.fillRect(x, y, 1.3, 1.3);
  }
  context.restore();

  context.lineWidth = 1.2;
  context.strokeStyle = '#7b9acf78';
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(235, 228);
  context.quadraticCurveTo(299, 221, 358, 158);
  context.quadraticCurveTo(409, 133, 493, 150);
  context.stroke();
  context.setLineDash([]);

  context.beginPath();
  context.moveTo(358, 158);
  context.bezierCurveTo(328, 92, 270, 76, 220, 114);
  context.shadowColor = '#5e96ff';
  context.shadowBlur = 14 * pixelRatio;
  context.strokeStyle = '#8cb3ff';
  context.lineWidth = 2.3;
  context.stroke();
  context.shadowBlur = 0;
}

if (context) new ResizeObserver(drawRouteMap).observe(canvas);
