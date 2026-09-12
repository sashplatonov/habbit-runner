package com.sashplatonov.habbit.runner.auth.dto;

public record WorkspaceNavigation(WorkspaceScreen screen, String selectedHabitId) {
  public WorkspaceNavigation {
    screen = screen == null ? WorkspaceScreen.DASHBOARD : screen;
    selectedHabitId = normalizedSelectedHabitId(selectedHabitId);
  }

  public WorkspaceNavigation() { this(WorkspaceScreen.DASHBOARD, null); }

  private static String normalizedSelectedHabitId(String selectedHabitId) {
    return selectedHabitId == null || selectedHabitId.isBlank() ? null : selectedHabitId;
  }
}
