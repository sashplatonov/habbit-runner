package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum ProgressPeriod {
  ONE_WEEK("1w"), FOUR_WEEKS("4w"), TWELVE_WEEKS("12w");

  private final String wireValue;

  ProgressPeriod(String wireValue) { this.wireValue = wireValue; }

  @JsonValue
  public String wireValue() { return wireValue; }

  @JsonCreator
  public static ProgressPeriod fromWireValue(String value) {
    for (var candidate : values()) {
      if (candidate.wireValue.equals(value)) {
        return candidate;
      }
    }
    return ONE_WEEK;
  }
}
