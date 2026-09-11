package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ProgressWorkspacePreferences(ProgressPeriod period) {
  public ProgressWorkspacePreferences {
    period = period == null ? ProgressPeriod.ONE_WEEK : period;
  }

  public ProgressWorkspacePreferences() { this(ProgressPeriod.ONE_WEEK); }
}
