import { createRequire } from 'node:module';
import pkg from '@voximplant/apiclient-nodejs';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('voximplant-management-sdk.service');
const require = createRequire(import.meta.url);

interface VoximplantSdkAxios {
  defaults?: {
    proxy?: boolean;
  };
}

interface ScenarioInfo {
  scenarioId?: number;
  scenarioName?: string;
  scenarioScript?: string;
  applicationId?: number;
  applicationName?: string;
  extendedApplicationName?: string;
}

interface GetScenariosRequest {
  scenarioId?: number;
  scenarioName?: string;
  withScript?: boolean;
  count?: number;
  offset?: number;
  applicationId?: number;
  applicationName?: string;
}

interface GetScenariosResponse {
  result?: ScenarioInfo[];
  totalCount?: number;
  count?: number;
  applicationId?: number;
  applicationName?: string;
  extendedApplicationName?: string;
}

interface SetScenarioInfoRequest {
  scenarioId?: number;
  requiredScenarioName?: string;
  scenarioName?: string;
  scenarioScript?: string;
}

interface SetScenarioInfoResponse {
  result?: number;
}

interface StartScenariosRequest {
  ruleId: number;
  userId?: number;
  userName?: string;
  applicationId?: number;
  applicationName?: string;
  scriptCustomData?: string;
  referenceIp?: string;
  serverLocation?: string;
}

interface StartScenariosResponse {
  result?: number;
  mediaSessionAccessUrl?: string;
  mediaSessionAccessSecureUrl?: string;
  callSessionHistoryId?: number;
}

export interface VoximplantCallEndReason {
  code?: number;
  details?: string;
}

export interface VoximplantCallHistoryCall {
  transactionId?: number;
  transaction_id?: number;
  incoming?: boolean;
  audioQuality?: string;
  audio_quality?: string;
  cost?: number;
  endReason?: VoximplantCallEndReason;
  end_reason?: VoximplantCallEndReason;
  remoteNumberType?: string;
  remote_number_type?: string;
  diversionNumber?: string;
  diversion_number?: string;
  localNumber?: string;
  local_number?: string;
  remoteNumber?: string;
  remote_number?: string;
  callId?: number;
  call_id?: number;
  duration?: number;
  startTime?: string;
  start_time?: string;
  successful?: boolean;
  direction?: string;
}

export interface VoximplantCallHistorySession {
  callSessionHistoryId?: number;
  startDate?: string;
  duration?: number;
  finishReason?: string;
  applicationName?: string;
  ruleName?: string;
  customData?: string;
  calls?: VoximplantCallHistoryCall[];
}

export interface GetCallHistoryRequest {
  fromDate: Date;
  toDate: Date;
  timezone?: string;
  callSessionHistoryId?: 'any' | number | number[];
  applicationId?: number;
  applicationName?: string;
  userId?: 'any' | number | number[];
  ruleName?: string;
  remoteNumber?: string | string[];
  remoteNumberList?: unknown;
  localNumber?: string | string[];
  callSessionHistoryCustomData?: string;
  withCalls?: boolean;
  withRecords?: boolean;
  withOtherResources?: boolean;
  childAccountId?: 'any' | number | number[];
  childrenCallsOnly?: boolean;
  descOrder?: boolean;
  withTotalCount?: boolean;
  count?: number;
  offset?: number;
}

export interface GetCallHistoryResponse {
  result?: VoximplantCallHistorySession[];
  totalCount?: number;
  count?: number;
  timezone?: string;
}

interface AttachedPhoneInfo {
  phoneNumber?: string;
  phoneId?: number;
  activationStatus?: string;
  canBeUsed?: boolean;
  applicationName?: string;
  ruleId?: number;
  ruleName?: string;
}

interface GetPhoneNumbersRequest {
  phoneNumber?: string;
  phoneId?: number | number[];
  applicationId?: number;
  applicationName?: string;
  count?: number;
  offset?: number;
}

interface GetPhoneNumbersResponse {
  result?: AttachedPhoneInfo[];
  totalCount?: number;
  count?: number;
}

interface AttachPhoneNumberRequest {
  phoneCount?: number;
  phoneNumber?: string | string[];
  countryCode?: string;
  phoneCategoryName?: string;
  phoneRegionId?: number;
  countryState?: string;
  regulationAddressId?: number;
}

interface AttachPhoneNumberResponse {
  result?: number;
  phoneNumbers?: {
    subscriptionId?: number;
    phoneNumber?: string;
    phoneId?: number;
    verificationStatus?: string;
  }[];
}

interface BindPhoneNumberToApplicationRequest {
  phoneId?: number | number[];
  phoneNumber?: string | string[];
  applicationId?: number;
  applicationName?: string;
  ruleId?: number;
  ruleName?: string;
  bind?: boolean;
}

interface BindPhoneNumberToApplicationResponse {
  result?: number;
}

export interface UserInfo {
  userId?: number;
  userName?: string;
  userDisplayName?: string;
  active?: boolean;
  applicationId?: number;
  applicationName?: string;
}

export interface GetUsersRequest {
  userId?: number | number[];
  userName?: string | string[];
  applicationId?: number;
  applicationName?: string;
  count?: number;
  offset?: number;
}

export interface GetUsersResponse {
  result?: UserInfo[];
  totalCount?: number;
  count?: number;
}

interface VoximplantScenariosApi {
  getScenarios(request: GetScenariosRequest): Promise<GetScenariosResponse>;
  setScenarioInfo(request: SetScenarioInfoRequest): Promise<SetScenarioInfoResponse>;
  startScenarios(request: StartScenariosRequest): Promise<StartScenariosResponse>;
}

interface VoximplantPhoneNumbersApi {
  getPhoneNumbers(request: GetPhoneNumbersRequest): Promise<GetPhoneNumbersResponse>;
  attachPhoneNumber(request: AttachPhoneNumberRequest): Promise<AttachPhoneNumberResponse>;
  bindPhoneNumberToApplication(
    request: BindPhoneNumberToApplicationRequest,
  ): Promise<BindPhoneNumberToApplicationResponse>;
}

interface VoximplantUsersApi {
  getUsers(request: GetUsersRequest): Promise<GetUsersResponse>;
}

interface VoximplantHistoryApi {
  getCallHistory(request: GetCallHistoryRequest): Promise<GetCallHistoryResponse>;
}

interface SecretRow {
  secretId?: number;
  secretName?: string;
}
interface GetSecretsRequest {
  applicationId?: number;
  applicationName?: string;
}
interface GetSecretsResponse {
  result?: SecretRow[];
}
interface AddSecretRequest {
  applicationId?: number;
  applicationName?: string;
  secretName: string;
  secretValue: string;
}
interface AddSecretResponse {
  result?: unknown;
}
interface SetSecretInfoRequest {
  applicationId?: number;
  secretId: number;
  secretValue?: string;
}
interface SetSecretInfoResponse {
  result?: number;
}
interface VoximplantSecretsApi {
  getSecrets(request: GetSecretsRequest): Promise<GetSecretsResponse>;
  addSecret(request: AddSecretRequest): Promise<AddSecretResponse>;
  setSecretInfo(request: SetSecretInfoRequest): Promise<SetSecretInfoResponse>;
}

interface ApplicationRow {
  applicationId?: number;
  applicationName?: string;
}
interface GetApplicationsRequest {
  applicationId?: number;
  applicationName?: string;
  count?: number;
}
interface GetApplicationsResponse {
  result?: ApplicationRow[];
}
interface VoximplantApplicationsApi {
  getApplications(request: GetApplicationsRequest): Promise<GetApplicationsResponse>;
}

interface VoximplantSdkClient {
  onReady: ((client: VoximplantSdkClient) => void) | undefined;
  Scenarios: VoximplantScenariosApi;
  PhoneNumbers: VoximplantPhoneNumbersApi;
  Users: VoximplantUsersApi;
  History: VoximplantHistoryApi;
  Secrets: VoximplantSecretsApi;
  Applications: VoximplantApplicationsApi;
}

interface VoximplantApiClientParameters {
  pathToCredentials?: string;
  host?: string;
  accountId?: number;
}

type VoximplantApiClientConstructor = new (parameters?: VoximplantApiClientParameters) => VoximplantSdkClient;
interface ModuleWithDefaultExport {
  default?: unknown;
}

const sdkAxios = require('@voximplant/apiclient-nodejs/node_modules/axios') as VoximplantSdkAxios;
if (sdkAxios.defaults) {
  sdkAxios.defaults.proxy = false;
}

function hasDefaultExport(moduleValue: unknown): moduleValue is ModuleWithDefaultExport {
  return typeof moduleValue === 'object' && moduleValue !== null && 'default' in moduleValue;
}

function resolveSdkConstructor(moduleValue: unknown): VoximplantApiClientConstructor | undefined {
  if (typeof moduleValue === 'function') {
    return moduleValue as VoximplantApiClientConstructor;
  }
  if (hasDefaultExport(moduleValue)) {
    const candidate = moduleValue.default;
    if (typeof candidate === 'function') {
      return candidate as VoximplantApiClientConstructor;
    }
  }
  return undefined;
}

const VoximplantApiClient = resolveSdkConstructor(pkg);

let clientPromise: Promise<VoximplantSdkClient> | null = null;

function getSdkHost(): string {
  try {
    return new URL(config.voximplant.apiBaseUrl).host;
  } catch {
    return 'api.voximplant.com';
  }
}

function getSdkCredentialsPath(): string {
  return config.voximplant.credentialsPath;
}

export function isVoximplantSdkConfigured(): boolean {
  return !!config.voximplant.accountId
    && !!getSdkCredentialsPath()
    && !!VoximplantApiClient;
}

async function getClient(): Promise<VoximplantSdkClient> {
  if (!VoximplantApiClient) {
    throw new Error('Voximplant SDK constructor is unavailable');
  }

  const credentialsPath = getSdkCredentialsPath();
  if (!credentialsPath) {
    throw new Error('VOXIMPLANT_CREDENTIALS_PATH is not configured');
  }

  if (!clientPromise) {
    clientPromise = new Promise<VoximplantSdkClient>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out while initializing Voximplant SDK'));
      }, 10_000);

      try {
        const client = new VoximplantApiClient({
          pathToCredentials: credentialsPath,
          host: getSdkHost(),
          accountId: Number(config.voximplant.accountId),
        });

        client.onReady = () => {
          clearTimeout(timeout);
          resolve(client);
        };
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    }).catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
}

async function callSdk<T>(label: string, action: (client: VoximplantSdkClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    return await action(client);
  } catch (error: unknown) {
    logger.error(`Voximplant SDK ${label} failed`, { error: String(error) });
    throw error;
  }
}

export async function getSdkScenarios(request: GetScenariosRequest): Promise<GetScenariosResponse> {
  return callSdk('getScenarios', (client) => client.Scenarios.getScenarios(request));
}

export async function getSdkApplications(): Promise<GetApplicationsResponse> {
  return callSdk('getApplications', (client) => client.Applications.getApplications({ count: 100 }));
}

export async function getSdkSecrets(applicationId: number): Promise<GetSecretsResponse> {
  return callSdk('getSecrets', (client) => client.Secrets.getSecrets({ applicationId }));
}

export async function addSdkSecret(
  applicationId: number,
  secretName: string,
  secretValue: string,
): Promise<AddSecretResponse> {
  return callSdk('addSecret', (client) => client.Secrets.addSecret({ applicationId, secretName, secretValue }));
}

export async function setSdkSecretInfo(
  applicationId: number,
  secretId: number,
  secretValue: string,
): Promise<SetSecretInfoResponse> {
  return callSdk('setSecretInfo', (client) => client.Secrets.setSecretInfo({ applicationId, secretId, secretValue }));
}

export async function setSdkScenarioInfo(
  request: SetScenarioInfoRequest,
): Promise<SetScenarioInfoResponse> {
  return callSdk('setScenarioInfo', (client) => client.Scenarios.setScenarioInfo(request));
}

export async function startSdkScenarios(
  request: StartScenariosRequest,
): Promise<StartScenariosResponse> {
  return callSdk('startScenarios', (client) => client.Scenarios.startScenarios(request));
}

export async function getSdkPhoneNumbers(
  request: GetPhoneNumbersRequest,
): Promise<GetPhoneNumbersResponse> {
  return callSdk('getPhoneNumbers', (client) => client.PhoneNumbers.getPhoneNumbers(request));
}

export async function getSdkUsers(request: GetUsersRequest): Promise<GetUsersResponse> {
  return callSdk('getUsers', (client) => client.Users.getUsers(request));
}

export async function getSdkCallHistory(request: GetCallHistoryRequest): Promise<GetCallHistoryResponse> {
  return callSdk('getCallHistory', (client) => client.History.getCallHistory(request));
}

export async function attachSdkPhoneNumber(
  request: AttachPhoneNumberRequest,
): Promise<AttachPhoneNumberResponse> {
  return callSdk('attachPhoneNumber', (client) => client.PhoneNumbers.attachPhoneNumber(request));
}

export async function bindSdkPhoneNumberToApplication(
  request: BindPhoneNumberToApplicationRequest,
): Promise<BindPhoneNumberToApplicationResponse> {
  return callSdk('bindPhoneNumberToApplication', (client) =>
    client.PhoneNumbers.bindPhoneNumberToApplication(request),
  );
}
