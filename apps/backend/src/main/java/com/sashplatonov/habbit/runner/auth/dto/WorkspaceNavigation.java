package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record WorkspaceNavigation(WorkspaceScreen screen, String selectedHabitId) {
  public WorkspaceNavigation {
    screen = screen == null ? WorkspaceScreen.DASHBOARD : screen;
    selectedHabitId = selectedHabitId == null || selectedHabitId.isBlank() ? null : selectedHabitId;
  }

  public WorkspaceNavigation() { this(WorkspaceScreen.DASHBOARD, null); }
}
