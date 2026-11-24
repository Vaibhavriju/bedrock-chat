export type UsageRule = {
  dailyRequests: number | null;
  monthlyRequests: number | null;
  maxOutputTokens: number | null;
};
export type ModelUsageRule = UsageRule & {
  enabled: boolean;
  dailyRequestsPerUser: number | null;
  monthlyRequestsPerUser: number | null;
};
export type UserUsageRule = UsageRule & { allowedModels: string[] | null };
export type UsagePolicy = {
  revision: number;
  workspace: UsageRule;
  defaultUser: UsageRule;
  models: Record<string, ModelUsageRule>;
  users: Record<string, UserUsageRule>;
};
export type UsageSnapshot = {
  configured: boolean;
  timezone: string;
  day: string;
  month: string;
  model: string;
  notice: string;
  scopes: (UsageRule & { scope: string; day: number; month: number })[];
};
export const emptyRule = (): UsageRule => ({
  dailyRequests: null,
  monthlyRequests: null,
  maxOutputTokens: null,
});
export const emptyModelRule = (): ModelUsageRule => ({
  ...emptyRule(),
  enabled: true,
  dailyRequestsPerUser: null,
  monthlyRequestsPerUser: null,
});
