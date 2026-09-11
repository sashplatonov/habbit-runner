package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum DashboardSort {
  CUSTOM("custom"), SMART("smart");

  private final String wireValue;

  DashboardSort(String wireValue) { this.wireValue = wireValue; }

  @JsonValue
  public String wireValue() { return wireValue; }

  @JsonCreator
  public static DashboardSort fromWireValue(String value) {
    for (var candidate : values()) {
      if (candidate.wireValue.equals(value)) {
        return candidate;
      }
    }
    return CUSTOM;
  }
}
