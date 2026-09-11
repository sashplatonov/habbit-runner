package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum DashboardDensity {
  COMFORTABLE("comfortable"), COMPACT("compact");

  private final String wireValue;

  DashboardDensity(String wireValue) { this.wireValue = wireValue; }

  @JsonValue
  public String wireValue() { return wireValue; }

  @JsonCreator
  public static DashboardDensity fromWireValue(String value) {
    for (var candidate : values()) {
      if (candidate.wireValue.equals(value)) {
        return candidate;
      }
    }
    return COMFORTABLE;
  }
}
