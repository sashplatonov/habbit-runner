package com.sashplatonov.habbit.runner.auth.dto;


import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public record UserWorkspacePreferences(
    Integer version,
    DashboardWorkspacePreferences dashboard,
    ProgressWorkspacePreferences progress,
    WorkspaceNavigation navigation,
  List<ThemeUsage> themeUsage
) {
  public UserWorkspacePreferences {
    version = defaultVersion(version);
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

  private static Integer defaultVersion(Integer version) {
    return version == null ? Integer.valueOf(1) : version;
  }
}
