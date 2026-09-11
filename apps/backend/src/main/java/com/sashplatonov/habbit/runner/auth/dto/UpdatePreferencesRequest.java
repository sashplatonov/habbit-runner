package com.sashplatonov.habbit.runner.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record UpdatePreferencesRequest(
    @NotBlank String theme,
    String timezone,
    DashboardPreferences dashboard,
    UserWorkspacePreferences workspace,
    Long revision
) {
  public UpdatePreferencesRequest(String theme, String timezone) {
    this(theme, timezone, null, null, null);
  }

  public UpdatePreferencesRequest(String theme, String timezone, DashboardPreferences dashboard) {
    this(theme, timezone, dashboard, null, null);
  }
}
