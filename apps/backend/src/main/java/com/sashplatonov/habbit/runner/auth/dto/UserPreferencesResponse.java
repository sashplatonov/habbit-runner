package com.sashplatonov.habbit.runner.auth.dto;

public record UserPreferencesResponse(
    String theme,
    String timezone,
    DashboardPreferences dashboard,
    UserWorkspacePreferences workspace,
    Long revision
) {
  public UserPreferencesResponse(String theme, String timezone) {
    this(theme, timezone, new DashboardPreferences(), new UserWorkspacePreferences(), 0L);
  }
}
