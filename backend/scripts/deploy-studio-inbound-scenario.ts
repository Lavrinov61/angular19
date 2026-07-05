import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  getSdkScenarios,
  setSdkScenarioInfo,
} from '../src/services/voximplant-management-sdk.service.js';

const scenarioId = 3369800;
const scenarioName = 'studio-inbound';
const scenarioPath = resolve(process.cwd(), 'src/voximplant-scenarios/studio-inbound.js');

const scenarioScript = await readFile(scenarioPath, 'utf8');

await setSdkScenarioInfo({
  scenarioId,
  requiredScenarioName: scenarioName,
  scenarioScript,
});

const response = await getSdkScenarios({
  scenarioId,
  withScript: true,
});
const scenario = response.result?.[0];

process.stdout.write(`${JSON.stringify({
  deployed: scenario?.scenarioName === scenarioName,
  scenarioId: scenario?.scenarioId,
  scenarioName: scenario?.scenarioName,
  scriptLength: scenario?.scenarioScript?.length ?? 0,
})}\n`);
