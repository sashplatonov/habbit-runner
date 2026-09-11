package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record UserWorkspacePreferences(
    Integer version,
    DashboardWorkspacePreferences dashboard,
    ProgressWorkspacePreferences progress,
    WorkspaceNavigation navigation,
    List<ThemeUsage> themeUsage
) {
  public UserWorkspacePreferences {
    version = version == null ? 1 : version;
    dashboard = dashboard == null ? new DashboardWorkspacePreferences() : dashboard;
    progress = progress == null ? new ProgressWorkspacePreferences() : progress;
    navigation = navigation == null ? new WorkspaceNavigation() : navigation;
    themeUsage = Collections.unmodifiableList(new ArrayList<>(themeUsage == null ? List.of() : themeUsage));
  }

  @Override
  public List<ThemeUsage> themeUsage() {
    return Collections.unmodifiableList(new ArrayList<>(themeUsage));
  }

  public UserWorkspacePreferences() {
    this(1, new DashboardWorkspacePreferences(), new ProgressWorkspacePreferences(), new WorkspaceNavigation(), List.of());
  }
}
