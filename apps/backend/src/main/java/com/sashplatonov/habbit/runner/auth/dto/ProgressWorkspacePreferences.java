package com.sashplatonov.habbit.runner.auth.dto;

public record ProgressWorkspacePreferences(ProgressPeriod period) {
  public ProgressWorkspacePreferences {
    period = period == null ? ProgressPeriod.ONE_WEEK : period;
  }

  public ProgressWorkspacePreferences() { this(ProgressPeriod.ONE_WEEK); }
}
