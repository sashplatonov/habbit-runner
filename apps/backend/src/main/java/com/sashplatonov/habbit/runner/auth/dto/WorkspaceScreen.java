package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum WorkspaceScreen {
  DASHBOARD("dashboard"), PROGRESS("progress"), ACCOUNT("account"), HABIT_DETAIL("habit-detail");

  private final String wireValue;

  WorkspaceScreen(String wireValue) { this.wireValue = wireValue; }

  @JsonValue
  public String wireValue() { return wireValue; }

  @JsonCreator
  public static WorkspaceScreen fromWireValue(String value) {
    for (var candidate : values()) {
      if (candidate.wireValue.equals(value)) {
        return candidate;
      }
    }
    return DASHBOARD;
  }
}
