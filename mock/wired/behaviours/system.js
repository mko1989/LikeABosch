export default {
  GetSystemPowerMode: ({ state }) => ({ powerMode: state.powerMode }),
  SetSystemPowerMode: (ctx, { powerMode }) => {
    if (!['poweredOn', 'poweredOff'].includes(powerMode)) ctx.fail(`Cannot set power mode '${powerMode}'`);
    ctx.state.powerMode = powerMode;
    ctx.fire('systemPowerModeChanged');
    return {};
  },
  GetMasterVolume: ({ state }) => ({ volume: state.masterVolume }),
  GetMasterVolumeRange: ({ state }) => ({ range: state.masterVolumeRange }),
  SetMasterVolume: (ctx, { volume }) => {
    const { minimumVolume, maximumVolume } = ctx.state.masterVolumeRange;
    if (typeof volume !== 'number' || volume < minimumVolume || volume > maximumVolume) {
      ctx.fail(`Volume must be between ${minimumVolume} and ${maximumVolume}`);
    }
    ctx.state.masterVolume = volume;
    ctx.fire('masterVolumeChanged');
    return {};
  },
  EnableSeatIllumination: (ctx, { enable }) => {
    ctx.state.seatIlluminationEnabled = Boolean(enable);
    if (!enable) ctx.state.illuminatedSeatId = '';
    ctx.fire('enableSeatIlluminationChanged', 'illuminatedSeatChanged');
    return {};
  },
  GetIlluminatedSeat: ({ state }) => ({ seatId: state.illuminatedSeatId ?? '' }),
  SetIlluminateSeat: (ctx, { seatId, setIlluminate }) => {
    if (!ctx.state.seatIlluminationEnabled) ctx.fail('Seat illumination is not enabled');
    if (!ctx.state.seats.some(s => s.seatId === seatId)) ctx.fail(`Seat '${seatId}' does not exist`);
    ctx.state.illuminatedSeatId = setIlluminate ? seatId : '';
    ctx.fire('illuminatedSeatChanged');
    return {};
  },
  GetPresentationState: ({ state }) => ({ isPresentationEnabled: state.isPresentationEnabled }),
  ActivatePresentation: ctx => {
    ctx.state.isPresentationEnabled = true;
    ctx.fire('presentationStateChanged');
    return {};
  },
  DeactivatePresentation: ctx => {
    ctx.state.isPresentationEnabled = false;
    ctx.fire('presentationStateChanged');
    return {};
  },
};
